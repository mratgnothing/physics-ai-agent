const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
const { spawn } = require('child_process');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_API_KEY = process.env.SILICON_API_KEY;
const API_BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_MODELS = {
  rag: 'Pro/moonshotai/Kimi-K2.5',
  code: 'Pro/zai-org/GLM-4.7',
  diagnosis: 'Pro/zai-org/GLM-4.7',
  advice: 'Pro/deepseek-ai/DeepSeek-V3'
};
const MODEL_OPTIONS = [
  { value: 'default', label: '默认多 Agent 模型' },
  { value: 'Pro/moonshotai/Kimi-K2.5', label: 'Kimi-K2.5' },
  { value: 'Pro/zai-org/GLM-4.7', label: 'GLM-4.7' },
  { value: 'Pro/deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
  { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3 标准版' },
  { value: 'Qwen/Qwen3-235B-A22B-Instruct-2507', label: 'Qwen3-235B' }
];

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const RESULTS_DIR = path.join(__dirname, 'public', 'results');
const PYTHON_BIN = process.env.PYTHON_PATH || process.env.PYTHON || 'python';
const ANALYSIS_TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS || 90000);

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.use(express.static('public'));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeModelName(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const model = value.trim();
  if (!model) return fallback;
  if (model.length > 160 || /[\s"'<>]/.test(model)) {
    throw new Error('模型名称格式不合法');
  }
  return model;
}

function createRuntimeConfig(input = {}) {
  const apiKey = normalizeApiKey(input.apiKey) || DEFAULT_API_KEY;
  if (!apiKey) {
    throw new Error('请在页面填写 API Key，或在 .env 中配置 SILICON_API_KEY');
  }

  const selectedModel = normalizeModelName(input.customModel || input.model || '');
  const useSingleModel = input.modelStrategy === 'single' && selectedModel && selectedModel !== 'default';
  const models = useSingleModel
    ? {
        rag: selectedModel,
        code: selectedModel,
        diagnosis: selectedModel,
        advice: selectedModel
      }
    : { ...DEFAULT_MODELS };

  return {
    apiKey,
    modelStrategy: useSingleModel ? 'single' : 'default',
    selectedModel: useSingleModel ? selectedModel : 'default',
    models
  };
}

async function callSiliconFlow(model, messages, options = {}, runtimeConfig = {}) {
  const apiKey = runtimeConfig.apiKey || DEFAULT_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 API Key，请在页面填写或检查 .env 配置');
  }

  const defaultOptions = {
    stream: false,
    temperature: 0.7,
    top_p: 0.7,
    max_tokens: 4096,
    response_format: { type: 'text' }
  };
  const { timeout, ...modelOptions } = options;

  try {
    const response = await axios.post(
      API_BASE_URL,
      {
        model,
        messages,
        ...defaultOptions,
        ...modelOptions
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: timeout || 1200000
      }
    );

    const content = response.data.choices[0].message.content.trim();
    console.log(`API调用成功 [模型: ${model}]`);
    return content;
  } catch (error) {
    const detail = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`API调用失败 [模型: ${model}]:`, detail);
    throw error;
  }
}

function emitProgress(onProgress, stage, status, progress, extra = {}) {
  if (onProgress) {
    onProgress({ stage, status, progress, ...extra });
  }
}

function stripPythonFence(content) {
  const fenced = content.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  let code = fenced ? fenced[1] : content;

  const firstImport = code.search(/(^|\n)\s*(import|from)\s+[A-Za-z_]/);
  if (firstImport > 0) {
    code = code.slice(firstImport).trim();
  }

  return code
    .replace(/^\s*```(?:python|py)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function validateGeneratedPython(code) {
  const forbidden = [
    /\bsubprocess\b/i,
    /\bsocket\b/i,
    /\brequests\b/i,
    /\burllib\b/i,
    /\bftplib\b/i,
    /\bparamiko\b/i,
    /\bwin32com\b/i,
    /\bctypes\b/i,
    /\bos\.system\s*\(/i,
    /\bos\.popen\s*\(/i,
    /\bshutil\.rmtree\s*\(/i,
    /\beval\s*\(/i,
    /\bexec\s*\(/i,
    /\b__import__\s*\(/i
  ];

  const hit = forbidden.find((pattern) => pattern.test(code));
  if (hit) {
    throw new Error(`生成的 Python 代码包含不允许的调用：${hit}`);
  }

  if (!/\bjson\b/.test(code) || !/analysis_result\.json/.test(code)) {
    console.warn('生成的 Python 代码没有显式写出 analysis_result.json，将继续执行并尝试从 stdout 解析。');
  }
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

async function runPythonAnalysis(code, runId) {
  const runDir = path.join(RESULTS_DIR, runId);
  const scriptPath = path.join(SCRIPTS_DIR, `analysis_${runId}.py`);
  await fs.ensureDir(runDir);
  await fs.writeFile(scriptPath, code, 'utf8');

  const env = {
    ...process.env,
    MPLBACKEND: 'Agg',
    PYTHONIOENCODING: 'utf-8'
  };

  const startedAt = Date.now();
  const execution = await new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [scriptPath, runDir], {
      cwd: runDir,
      env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, ANALYSIS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        timedOut,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim()
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        timedOut,
        exitCode,
        stdout,
        stderr
      });
    });
  });

  const artifacts = await collectArtifacts(runDir, runId);
  const resultJson = await readAnalysisJson(runDir, execution.stdout);

  return {
    ...execution,
    runId,
    durationMs: Date.now() - startedAt,
    scriptPath,
    resultPath: path.join(runDir, 'analysis_result.json'),
    resultJson,
    artifacts
  };
}

async function collectArtifacts(runDir, runId) {
  if (!(await fs.pathExists(runDir))) return [];

  const files = await fs.readdir(runDir);
  return files
    .filter((name) => /\.(png|jpg|jpeg|svg|json|csv)$/i.test(name))
    .map((name) => ({
      name,
      url: `/results/${runId}/${encodeURIComponent(name)}`,
      type: path.extname(name).slice(1).toLowerCase()
    }));
}

async function readAnalysisJson(runDir, stdout) {
  const resultPath = path.join(runDir, 'analysis_result.json');
  if (await fs.pathExists(resultPath)) {
    try {
      return await fs.readJson(resultPath);
    } catch (error) {
      return { status: 'json_parse_error', error: error.message };
    }
  }

  const match = stdout.match(/\{[\s\S]*\}\s*$/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return { status: 'stdout_json_parse_error', error: error.message };
    }
  }

  return {
    status: 'missing_result_json',
    summary: 'Python 脚本执行结束，但没有产生 analysis_result.json。'
  };
}

function compactExecutionForPrompt(execution) {
  const payload = {
    ok: execution.ok,
    timedOut: execution.timedOut,
    exitCode: execution.exitCode,
    durationMs: execution.durationMs,
    resultJson: execution.resultJson,
    stdout: execution.stdout.slice(-3000),
    stderr: execution.stderr.slice(-3000),
    artifacts: execution.artifacts.map((item) => item.name)
  };

  return JSON.stringify(payload, null, 2).slice(0, 9000);
}

function buildAnalysisCodePrompt(dataText, ragResult) {
  return `
你是严谨的实验物理数据分析工程师。请根据“实验数据”和“讲义分析”生成一段完整可运行的 Python 3 代码。

硬性要求：
1. 只输出 Python 代码，不要 Markdown 代码块，不要解释。
2. 只能使用标准库、numpy、scipy、matplotlib、pandas（如可用）。不得使用网络、系统命令、子进程、交互输入。
3. 必须在开头设置 matplotlib 非交互后端：import matplotlib; matplotlib.use("Agg")。
4. 程序从 sys.argv[1] 获取输出目录 output_dir；如果没有该参数，就使用当前目录。
5. 必须完成真实拟合、残差计算、关键参数计算和至少一张图像输出。
6. 必须把结构化结果写入 output_dir/analysis_result.json，且同时 print 这份 JSON。
7. 必须把主要图像保存为 output_dir/analysis_plot.png，必要时可保存更多图像。
8. analysis_result.json 必须尽量包含这些字段：
   {
     "status": "ok 或 warning",
     "experiment_type": "实验类型",
     "summary": "一段中文概述",
     "fit_parameters": [{"name": "...", "value": 数值或字符串, "unit": "...", "method": "..."}],
     "metrics": {"r_squared": 数值或 null, "rmse": 数值或 null, "chi_square": 数值或 null},
     "residuals": [{"series": "...", "n": 数值, "mean": 数值, "std": 数值, "max_abs": 数值, "pattern": "中文描述"}],
     "model_warnings": ["模型适用条件或数据问题"],
     "generated_files": ["analysis_plot.png"]
   }
9. 如果数据格式不标准，不要编造；应尽力提取可识别数值，并在 model_warnings 说明不确定性。

实验数据：
${dataText}

讲义分析：
${ragResult}
`.trim();
}

async function analyzeExperiment(manualText, dataText, onProgress, runtimeConfig) {
  await fs.ensureDir(SCRIPTS_DIR);
  await fs.ensureDir(RESULTS_DIR);
  const models = runtimeConfig.models || DEFAULT_MODELS;

  emitProgress(onProgress, 1, '正在提取非理想假设、误差来源和物理约束...', 12);
  const ragPrompt = `
请从以下实验讲义中提取信息，要求结构化输出：
1. 实验对象与核心物理模型
2. 关键公式、变量、单位
3. 非理想假设与适用条件
4. 主要误差来源和仪器精度
5. 后续数据分析时必须注意的物理约束

实验讲义：
${manualText}
`.trim();

  const ragResult = await callSiliconFlow(models.rag, [
    { role: 'user', content: ragPrompt }
  ], {}, runtimeConfig);

  emitProgress(onProgress, 2, '正在生成可执行的拟合、残差与可视化脚本...', 32);
  const rawPythonCode = await callSiliconFlow(models.code, [
    { role: 'user', content: buildAnalysisCodePrompt(dataText, ragResult) }
  ], { temperature: 0.05, top_p: 0.3, max_tokens: 6144 }, runtimeConfig);

  const pythonCode = stripPythonFence(rawPythonCode);
  validateGeneratedPython(pythonCode);

  emitProgress(onProgress, 3, '正在真实运行 Python 脚本并读取残差结果...', 52);
  const runId = createRunId();
  const execution = await runPythonAnalysis(pythonCode, runId);

  emitProgress(onProgress, 4, '正在基于真实计算结果生成物理诊断...', 72, {
    runId,
    executionOk: execution.ok
  });

  const diagPrompt = `
你是大学物理实验教师，请基于真实计算结果进行物理诊断。

请严格区分：
- 数据和脚本真实算出的结论
- 讲义中已有的物理约束
- 你的物理推断

输出要求：
1. 先给“计算证据摘要”，引用拟合参数、残差统计或脚本错误。
2. 再解释可能的物理机制，例如非线性阻尼、弹性系数变化、仪器零漂、相位读数偏差等。
3. 明确指出线性模型是否足够，若不足说明需要什么修正模型。
4. 不要编造没有出现在数据或讲义中的数值。

原始数据：
${dataText}

讲义提取：
${ragResult}

Python 真实执行结果：
${compactExecutionForPrompt(execution)}
`.trim();

  const diagnosis = await callSiliconFlow(models.diagnosis, [
    { role: 'user', content: diagPrompt }
  ], { temperature: 0.35, max_tokens: 4096 }, runtimeConfig);

  emitProgress(onProgress, 5, '正在生成实验优化建议书...', 88);
  const advicePrompt = `
请根据以下物理诊断，输出一份面向学生和实验室改进的优化建议书。
要求：
1. 分为“数据处理改进”“实验操作改进”“装置/模型改进”“下次复测清单”四部分。
2. 建议要尽量可执行，并说明预期改善哪一个残差或参数偏差。
3. 不要夸大确定性；对推断性建议标明验证方法。

物理诊断：
${diagnosis}

真实计算结果：
${compactExecutionForPrompt(execution)}
`.trim();

  let advice;
  try {
    console.log(`正在尝试使用 ${models.advice} 生成优化建议...`);
    advice = await callSiliconFlow(models.advice, [
      { role: 'user', content: advicePrompt }
    ], { timeout: 60000, temperature: 0.45 }, runtimeConfig);
  } catch (error) {
    console.warn(`${models.advice} 调用失败，尝试使用 GLM-4.7 作为备选:`, error.message);
    advice = await callSiliconFlow(DEFAULT_MODELS.diagnosis, [
      { role: 'user', content: advicePrompt }
    ], { temperature: 0.45 }, runtimeConfig);
  }

  emitProgress(onProgress, 6, '分析完成！', 100);

  return {
    rag: ragResult,
    pythonCode,
    execution: {
      ok: execution.ok,
      timedOut: execution.timedOut,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      runId: execution.runId,
      resultJson: execution.resultJson,
      stdout: execution.stdout.slice(-5000),
      stderr: execution.stderr.slice(-5000),
      artifacts: execution.artifacts
    },
    diagnosis,
    advice,
    modelConfig: {
      strategy: runtimeConfig.modelStrategy,
      selectedModel: runtimeConfig.selectedModel,
      models
    },
    scriptPath: execution.scriptPath,
    resultPath: execution.resultPath
  };
}

async function readUploadedText(file) {
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (ext === '.pdf') {
    const dataBuffer = await fs.readFile(file.path);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
  }

  return fs.readFile(file.path, 'utf8');
}

async function cleanupUploadedFiles(files) {
  const flatFiles = Object.values(files || {}).flat();
  await Promise.all(flatFiles.map((file) => fs.remove(file.path).catch(() => null)));
}

function agentLabel(sectionKey) {
  return {
    rag: '讲义理解 Agent',
    computation: '计算复核 Agent',
    diagnosis: '物理诊断 Agent',
    advice: '实验优化 Agent',
    python: '代码审查 Agent'
  }[sectionKey] || '物理实验诊断 Agent';
}

function modelForSection(sectionKey, models) {
  return {
    rag: models.rag,
    computation: models.diagnosis,
    diagnosis: models.diagnosis,
    advice: models.advice,
    python: models.code
  }[sectionKey] || models.diagnosis;
}

function parseModelJson(content) {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(raw);
  } catch (error) {
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function compactReportContext(report = {}) {
  const execution = report.execution || {};
  const resultJson = execution.resultJson || {};
  const payload = {
    modelConfig: report.modelConfig,
    computation: {
      ok: execution.ok,
      exitCode: execution.exitCode,
      resultJson,
      artifacts: Array.isArray(execution.artifacts)
        ? execution.artifacts.map((item) => item.name)
        : []
    },
    rag: report.rag,
    diagnosis: report.diagnosis,
    advice: report.advice
  };

  return JSON.stringify(payload, null, 2).slice(0, 12000);
}

async function askReportAgent(payload, runtimeConfig) {
  const sectionKey = payload.sectionKey || 'diagnosis';
  const selectedText = String(payload.selectedText || payload.paragraphText || '').trim().slice(0, 5000);
  const sectionMarkdown = String(payload.sectionMarkdown || '').trim().slice(0, 9000);
  const question = String(payload.question || '').trim().slice(0, 1200);

  if (!question) {
    throw new Error('请先输入要问的问题');
  }

  const prompt = `
你是${agentLabel(sectionKey)}。用户正在复核一份物理实验智能诊断报告，并针对报告中的一段文字提问。

请完成三件事：
1. 直接回答用户问题，必要时引用报告中的计算结果、拟合参数、残差或讲义约束。
2. 判断用户选中的段落是否存在事实、物理逻辑、计算解释或表达错误。
3. 如果存在错误，给出修订后的段落，并在“完整章节 Markdown”中只替换必要内容；如果没有错误，不要改写报告。

只输出 JSON，不要 Markdown 代码块。JSON 结构如下：
{
  "answer": "给用户的中文回答",
  "hasCorrection": false,
  "correctedText": null,
  "revisedSectionMarkdown": null,
  "correctionNote": ""
}

用户问题：
${question}

用户选中的段落：
${selectedText || '用户没有选中具体段落，请按本章节整体回答。'}

当前章节 Markdown：
${sectionMarkdown || '无'}

完整报告上下文：
${compactReportContext(payload.report)}
`.trim();

  const raw = await callSiliconFlow(
    modelForSection(sectionKey, runtimeConfig.models || DEFAULT_MODELS),
    [{ role: 'user', content: prompt }],
    { temperature: 0.25, max_tokens: 4096 },
    runtimeConfig
  );
  const parsed = parseModelJson(raw);

  if (!parsed || typeof parsed.answer !== 'string') {
    return {
      answer: raw,
      hasCorrection: false,
      correctedText: null,
      revisedSectionMarkdown: null,
      correctionNote: '模型没有返回结构化 JSON，已保留原始回答。'
    };
  }

  return {
    answer: parsed.answer || '',
    hasCorrection: Boolean(parsed.hasCorrection),
    correctedText: typeof parsed.correctedText === 'string' ? parsed.correctedText : null,
    revisedSectionMarkdown: typeof parsed.revisedSectionMarkdown === 'string' ? parsed.revisedSectionMarkdown : null,
    correctionNote: typeof parsed.correctionNote === 'string' ? parsed.correctionNote : ''
  };
}

app.get('/config', (req, res) => {
  res.json({
    hasServerApiKey: Boolean(DEFAULT_API_KEY),
    defaultModels: DEFAULT_MODELS,
    modelOptions: MODEL_OPTIONS
  });
});

app.post('/analyze', upload.fields([{ name: 'manualFile' }, { name: 'dataFile' }]), async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    if (!req.files || !req.files.manualFile) {
      return res.status(400).json({ success: false, error: '请上传实验讲义文件' });
    }

    const runtimeConfig = createRuntimeConfig(req.body);
    const manualText = await readUploadedText(req.files.manualFile[0]);
    const dataText = req.files.dataFile
      ? await readUploadedText(req.files.dataFile[0])
      : '数据已包含在讲义中，请从讲义文本中识别可用于计算的数据表。';

    const report = await analyzeExperiment(manualText, dataText, (progressInfo) => {
      res.write(`${JSON.stringify({ type: 'progress', ...progressInfo })}\n`);
    }, runtimeConfig);

    res.write(`${JSON.stringify({ type: 'result', success: true, report })}\n`);
    res.end();
    cleanupUploadedFiles(req.files);
  } catch (error) {
    console.error('服务器错误:', error);
    cleanupUploadedFiles(req.files);

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`${JSON.stringify({ type: 'error', error: error.message })}\n`);
      res.end();
    }
  }
});

app.post('/ask', async (req, res) => {
  try {
    const runtimeConfig = createRuntimeConfig(req.body);
    const result = await askReportAgent(req.body, runtimeConfig);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('段落追问失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Physics AI Agent upgraded running at http://${HOST}:${PORT}`);
  console.log(`Python runtime: ${PYTHON_BIN}`);
});
