# AGENTS.md — Codex Project Context

This file is written for Codex or other coding agents that need to understand and modify this repository quickly.

## Project Overview

`physics-ai-agent` is a web-based **Physics Experiment Intelligent Diagnosis Agent**. It helps students analyze university physics experiment materials and raw data through a reproducible workflow:

1. Upload an experiment manual, usually `.pdf` or `.txt`.
2. Optionally upload raw data, usually `.csv` or `.txt`.
3. Extract physical models, formulas, assumptions, variables, units, instrument limits, and error sources from the manual.
4. Generate a Python analysis script for fitting, residual analysis, metric calculation, and visualization.
5. Execute the generated Python script locally on the server.
6. Read the actual computed results and generated artifacts.
7. Produce a physics diagnosis and practical experiment-improvement suggestions.
8. Allow follow-up questions on specific report sections.

The core design goal is **not** to let the LLM merely describe results. The system must create and run real Python code, then base the final diagnosis on the computed output.

## Tech Stack

- Backend: Node.js, Express, CommonJS
- Frontend: static HTML page under `public/`, using Tailwind CDN, Marked, DOMPurify, and MathJax
- File upload: `multer`
- PDF text extraction: `pdf-parse`
- LLM API: SiliconFlow chat completions endpoint
- Computation runtime: Python 3 via `child_process.spawn`
- Python scientific packages: `numpy`, `scipy`, `matplotlib`, `pandas`
- Deployment: Docker and Render Web Service

## Important Files

- `server.js`
  - Main Express server.
  - Defines model defaults, runtime config, file upload handling, LLM calls, generated Python validation, Python execution, artifact collection, report generation, and follow-up Q&A.
- `public/index.html`
  - Main browser UI.
  - Handles file upload, model selection, progress streaming, report rendering, artifact display, Markdown rendering, MathJax rendering, and section-level follow-up questions.
- `requirements-python.txt`
  - Python dependencies used by generated analysis scripts.
- `Dockerfile`
  - Builds the production container with Node.js and Python runtime.
- `render.yaml`
  - Render deployment configuration.
- `DEPLOY_RENDER.md`
  - Render deployment notes.
- `.dockerignore`
  - Excludes local secrets, generated uploads, runtime outputs, logs, and generated analysis scripts from Docker image context.

## Runtime Flow

### `/config`

Returns whether the server has a default API key and exposes default model choices for the frontend.

### `/analyze`

Main analysis endpoint. It accepts multipart form data:

- `manualFile`: required experiment manual, `.pdf` or `.txt`
- `dataFile`: optional raw data, `.csv` or `.txt`
- `apiKey`: optional SiliconFlow API key from the user
- `modelStrategy`: `default` or `single`
- `model` / `customModel`: optional model selection

The endpoint streams NDJSON progress events and finally emits a result object.

The analysis pipeline is:

1. Read uploaded manual and data text.
2. Ask the RAG/lecture-understanding model to extract physics constraints and experimental assumptions.
3. Ask the code model to generate a complete Python script.
4. Strip Markdown fences from the generated code.
5. Validate that the code does not use dangerous modules or calls.
6. Write the script to `scripts/analysis_<runId>.py`.
7. Execute it with the output directory argument `public/results/<runId>/`.
8. Collect generated `.png`, `.jpg`, `.jpeg`, `.svg`, `.json`, and `.csv` artifacts.
9. Read `analysis_result.json` or parse JSON from stdout.
10. Ask the diagnosis model to explain the result using actual execution evidence.
11. Ask the advice model to produce improvement suggestions.
12. Return the full report to the frontend.

### `/ask`

Follow-up endpoint. It answers questions about a selected report section and can suggest a corrected paragraph or revised section Markdown when needed.

## Generated Python Contract

Generated Python analysis scripts should follow this contract:

- Use Python 3.
- Use `matplotlib` non-interactive backend: `matplotlib.use("Agg")`.
- Read output directory from `sys.argv[1]`; fall back to current directory if absent.
- Perform real fitting, residual calculation, metric calculation, and visualization.
- Save at least one figure as `analysis_plot.png`.
- Write structured JSON to `analysis_result.json`.
- Print the same JSON to stdout.
- Prefer fields like:
  - `status`
  - `experiment_type`
  - `summary`
  - `fit_parameters`
  - `metrics`
  - `residuals`
  - `model_warnings`
  - `generated_files`

Do not fake numerical conclusions. If data is incomplete or ambiguous, preserve uncertainty in `model_warnings`.

## Security and Safety Notes

- Never commit `.env`, API keys, uploaded files, generated results, logs, or generated analysis scripts.
- Keep `SILICON_API_KEY` only in local `.env`, Render environment variables, or user-provided runtime form input.
- Do not print or expose API keys in logs, UI, Markdown reports, or error messages.
- The generated Python validator blocks dangerous patterns such as network modules, subprocess usage, system calls, `eval`, `exec`, and destructive filesystem calls. Preserve or strengthen this validation when changing the code-generation pipeline.
- The current validation is a guardrail, not a complete sandbox. Avoid adding new features that allow arbitrary shell execution or unrestricted file access.

## Development Commands

Install Node dependencies:

```bash
npm install
```

Install Python dependencies:

```bash
python -m pip install -r requirements-python.txt
```

Run locally:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Optional local `.env`:

```env
SILICON_API_KEY=your_key_here
PORT=3000
PYTHON_PATH=python
ANALYSIS_TIMEOUT_MS=90000
```

For Docker:

```bash
docker build -t physics-ai-agent .
docker run --rm -p 3000:3000 -e SILICON_API_KEY=your_key_here physics-ai-agent
```

## Coding Guidelines for Future Agents

- Keep the app simple: this is currently a compact full-stack project, not a large framework app.
- Avoid introducing React/Vue/build tooling unless explicitly requested.
- Preserve the current upload → LLM prompt → Python execution → report rendering pipeline.
- Preserve the NDJSON streaming behavior of `/analyze`, because the frontend relies on incremental progress messages.
- Keep report outputs in Chinese unless a task explicitly asks for English.
- Keep physics wording rigorous: distinguish measured data, computed results, lecture/manual constraints, and model inference.
- When changing prompts, keep the generated JSON schema stable so the frontend rendering functions continue to work.
- When changing frontend rendering, sanitize Markdown/HTML and keep MathJax support for formulas.
- When adding tests or checks, prioritize:
  - API key missing path
  - PDF/txt manual parsing
  - CSV/txt data parsing
  - generated Python validation failures
  - Python timeout path
  - missing `analysis_result.json` fallback
  - artifact collection and display
  - `/ask` JSON parsing fallback

## Common Pitfalls

- Do not assume the LLM-generated code is correct just because the LLM says so; always rely on execution output.
- Do not change artifact paths casually. The frontend expects result artifacts under `/results/<runId>/...`.
- Do not remove `MPLBACKEND=Agg` or the explicit non-interactive backend requirement; server-side plotting must not require a GUI.
- Do not make uploaded files or generated scripts permanent user data unless the task explicitly asks for persistence.
- Do not hard-code a model name in the frontend only; keep backend defaults and frontend options consistent.
- Do not commit `node_modules`; it should stay ignored.

## Suggested Next Improvements

- Add a real `README.md` for users and a separate `AGENTS.md` for coding agents.
- Add a minimal integration test for `/config` and API-key validation.
- Add a safer Python execution sandbox or containerized per-run execution for stronger isolation.
- Split very large frontend logic into separate static JS/CSS files if maintainability becomes a problem.
- Add sample manual/data files under a safe `examples/` directory for demos and regression testing.
