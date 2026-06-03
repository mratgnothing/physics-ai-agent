import sys
import os
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import stats

def main():
    # 1. 获取输出目录
    if len(sys.argv) > 1:
        output_dir = sys.argv[1]
    else:
        output_dir = "."
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 2. 数据提取与定义 (基于实验数据和讲义分析)
    # 常数
    g = 9.79494  # 讲义指定南京地区重力加速度
    pi = np.pi

    # 几何参数 (单位: m)
    # 上圆盘悬孔间距离 a = 4.00 cm -> r
    a = 0.0400
    r = a / np.sqrt(3)
    
    # 悬盘悬孔间距离 b = 13.84 cm -> R
    b = 0.1384
    R = b / np.sqrt(3)
    
    # 上下盘垂直距离 H
    H = 0.332
    
    # 悬盘直径 d
    d = 0.1700
    
    # 圆环几何
    D1_out = 0.12000
    R1 = D1_out / 2.0
    D2_in = 0.10113 # 取平均值
    R2 = D2_in / 2.0
    
    # 圆柱体几何
    Dx = 0.02800
    Rx = Dx / 2.0
    x = 0.0600 # 圆柱体中心至悬盘中心距离

    # 质量 (单位: kg)
    m_disk = 0.50881
    m_ring = 0.3905  # 教师批注：M 错误！
    m_cyl_single = 0.17422

    # 周期数据 (单位: s)
    # 原始时间数据 (50次摆动)
    t_disk_raw = np.array([79.86, 80.15, 79.71])
    t_ring_raw = np.array([78.06, 77.85, 78.16])
    t_cyl_raw = np.array([79.26, 79.03, 79.00])
    
    # 计算平均周期 T = t / 50
    T_disk = np.mean(t_disk_raw) / 50.0
    T_ring = np.mean(t_ring_raw) / 50.0
    T_cyl = np.mean(t_cyl_raw) / 50.0
    
    # 周期标准差 (用于误差估计)
    std_T_disk = np.std(t_disk_raw, ddof=1) / 50.0
    std_T_ring = np.std(t_ring_raw, ddof=1) / 50.0
    std_T_cyl = np.std(t_cyl_raw, ddof=1) / 50.0

    # 3. 理论值计算
    # 悬盘理论值 J0_theo = 0.5 * m * (d/2)^2
    J0_theo = 0.5 * m_disk * (d / 2.0)**2
    
    # 圆环理论值 J_ring_theo = 0.5 * M * (R1^2 + R2^2)
    J_ring_theo = 0.5 * m_ring * (R1**2 + R2**2)
    
    # 圆柱体理论值 (单) J_cyl_theo = M' * x^2 + 0.5 * M' * Rx^2
    J_cyl_theo = m_cyl_single * x**2 + 0.5 * m_cyl_single * Rx**2

    # 4. 实验值计算
    # 通用系数 K = (m_total * g * R * r) / (4 * pi^2 * H)
    def calc_J_exp(m_total, T):
        K = (m_total * g * R * r) / (4 * pi**2 * H)
        return K * T**2

    # 悬盘实验值
    J0_exp = calc_J_exp(m_disk, T_disk)
    
    # 悬盘+圆环系统实验值
    J_sys_ring_exp = calc_J_exp(m_disk + m_ring, T_ring)
    J_ring_exp = J_sys_ring_exp - J0_exp
    
    # 悬盘+两圆柱体系统实验值
    J_sys_cyl_exp = calc_J_exp(m_disk + 2 * m_cyl_single, T_cyl)
    J_cyl_exp = (J_sys_cyl_exp - J0_exp) / 2.0

    # 5. 拟合分析 (验证实验值与理论值的线性关系)
    # 理想情况下 J_exp = J_theo (斜率1, 截距0)
    x_data = np.array([J0_theo, J_ring_theo, J_cyl_theo])
    y_data = np.array([J0_exp, J_ring_exp, J_cyl_exp])
    
    # 权重 (基于周期误差传递的简单估计: sigma_J ~ 2*J*sigma_T/T)
    sigma_J0 = 2 * J0_exp * (std_T_disk / T_disk)
    sigma_Jr = 2 * J_ring_exp * (std_T_ring / T_ring) # 近似
    sigma_Jc = 2 * J_cyl_exp * (std_T_cyl / T_cyl)   # 近似
    y_err = np.array([sigma_J0, sigma_Jr, sigma_Jc])

    slope, intercept, r_value, p_value, std_err = stats.linregress(x_data, y_data)
    
    # 预测值与残差
    y_pred = slope * x_data + intercept
    residuals = y_data - y_pred
    
    # 6. 指标计算
    # R squared
    r_squared = r_value**2
    
    # RMSE
    rmse = np.sqrt(np.mean(residuals**2))
    
    # Chi Square
    chi_square = np.sum((residuals**2) / (y_err**2))

    # 7. 绘图
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 10), gridspec_kw={'height_ratios': [2, 1]})
    
    # 主图：实验值 vs 理论值
    labels = ['悬盘', '圆环', '圆柱体']
    ax1.errorbar(x_data, y_data, yerr=y_err, fmt='o', label='实验值', capsize=5, color='blue')
    
    # 拟合线
    x_fit = np.linspace(0, max(x_data)*1.1, 100)
    y_fit = slope * x_fit + intercept
    ax1.plot(x_fit, y_fit, 'r--', label=f'拟合线: y={slope:.3f}x+{intercept:.2e}')
    
    # 理想线
    ax1.plot(x_fit, x_fit, 'k:', label='理想线 (y=x)', alpha=0.5)
    
    ax1.set_xlabel('理论转动惯量 $J_{theo}$ (kg·m$^2$)')
    ax1.set_ylabel('实验转动惯量 $J_{exp}$ (kg·m$^2$)')
    ax1.set_title('三线摆法测定转动惯量：实验值与理论值对比')
    ax1.legend()
    ax1.grid(True, linestyle='--', alpha=0.7)
    
    # 标注点
    for i, txt in enumerate(labels):
        ax1.annotate(txt, (x_data[i], y_data[i]), xytext=(5, 5), textcoords='offset points')

    # 残差图
    ax2.bar(labels, residuals, color=['green' if r > 0 else 'red' for r in residuals], alpha=0.7)
    ax2.axhline(0, color='black', linestyle='--')
    ax2.set_ylabel('残差 (kg·m$^2$)')
    ax2.set_title('拟合残差')
    ax2.grid(True, axis='y', linestyle='--', alpha=0.7)

    plt.tight_layout()
    plot_path = os.path.join(output_dir, "analysis_plot.png")
    plt.savefig(plot_path)
    plt.close()

    # 8. 构建结果 JSON
    result = {
        "status": "warning", # 存在教师批注的数据问题
        "experiment_type": "三线摆法测定物体转动惯量",
        "summary": "基于实验数据计算了悬盘、圆环及圆柱体的转动惯量。实验值与理论值进行了线性回归拟合，斜率为 {:.3f}，截距为 {:.2e}。数据存在一定偏差，特别是圆环质量数据被标注为错误。".format(slope, intercept),
        "fit_parameters": [
            {"name": "斜率", "value": float(slope), "unit": "无", "method": "最小二乘法"},
            {"name": "截距", "value": float(intercept), "unit": "kg·m^2", "method": "最小二乘法"},
            {"name": "相关系数 R", "value": float(r_value), "unit": "无", "method": "皮尔逊相关"}
        ],
        "metrics": {
            "r_squared": float(r_squared),
            "rmse": float(rmse),
            "chi_square": float(chi_square)
        },
        "residuals": [
            {"series": "悬盘", "n": 1, "mean": float(residuals[0]), "std": 0.0, "max_abs": float(abs(residuals[0])), "pattern": "负偏差"},
            {"series": "圆环", "n": 1, "mean": float(residuals[1]), "std": 0.0, "max_abs": float(abs(residuals[1])), "pattern": "正偏差"},
            {"series": "圆柱体", "n": 1, "mean": float(residuals[2]), "std": 0.0, "max_abs": float(abs(residuals[2])), "pattern": "负偏差"}
        ],
        "model_warnings": [
            "教师批注：圆环质量 M 错误！",
            "教师批注：周期有效数字问题，建议多取一位。",
            "教师批注：圆柱体偏移距离 x 的测量方法及数据存疑。",
            "数据点较少（仅3组），无法进行完整的 T^2-1/R 或 J-x^2 曲线拟合，仅做结果对比验证。",
            "计算采用讲义指定重力加速度 g=9.79494 m/s^2，与实验数据记录中的 9.8 存在微小差异。"
        ],
        "generated_files": ["analysis_plot.png"]
    }

    # 9. 输出结果
    json_path = os.path.join(output_dir, "analysis_result.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=4)
    
    print(json.dumps(result, ensure_ascii=False, indent=4))

if __name__ == "__main__":
    main()