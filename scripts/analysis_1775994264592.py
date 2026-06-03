
import numpy as np
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

# --- Data Definition ---

# Part 1: Free Vibration (Amplitude vs Period)
theta_free = np.array([160, 158, 157, 156, 154, 152, 150, 146, 142, 134, 127, 120, 112, 106, 102, 92, 86, 82, 78, 69, 66, 60, 56, 54, 52])
T_free = np.array([1.562, 1.563, 1.563, 1.564, 1.564, 1.565, 1.566, 1.566, 1.567, 1.569, 1.570, 1.571, 1.572, 1.573, 1.574, 1.575, 1.576, 1.577, 1.577, 1.578, 1.579, 1.580, 1.580, 1.580, 1.580])

# Part 2: Damped Vibration (Amplitude Decay)
theta_damp = np.array([166, 153, 140, 129, 119, 109, 100, 92, 84, 77])
T_10_damp = 15.720
T_damp_avg = T_10_damp / 10.0
t_damp = np.arange(len(theta_damp)) * T_damp_avg

# Part 3: Forced Vibration (Amplitude-Frequency & Phase-Frequency)
theta_forced = np.array([37, 40, 44, 49, 56, 65, 77, 92, 117, 140, 148, 140, 130, 118, 106, 96, 84, 76, 68, 63, 58])
T_forced = np.array([1.5090, 1.5140, 1.5202, 1.5267, 1.5330, 1.5394, 1.5456, 1.5508, 1.5570, 1.5622, 1.5699, 1.5765, 1.5824, 1.5883, 1.5952, 1.6010, 1.6085, 1.6144, 1.6211, 1.6264, 1.6330])
phi_forced = np.array([-161.0, -160.0, -158.5, -157.0, -155.0, -151.5, -146.5, -138.7, -123.8, -100.40, -81.5, -67.5, -59.0, -51.0, -44.5, -38.5, -34.5, -30.5, -26.5, -23.5, -20.0])
T0 = 1.5800
r_freq = T0 / T_forced  # Frequency ratio omega/omega0

# --- Fitting Functions ---

# 1. Polynomial fit for Free Vibration (T vs Theta)
def poly_func(x, a, b, c):
    return a * x**2 + b * x + c

# 2. Exponential decay for Damped Vibration
def exp_decay(t, A, delta):
    return A * np.exp(-delta * t)

# 3. Amplitude-Frequency Response (Lorentzian-like)
def amp_freq_response(r, theta_r, beta):
    # theta = theta_r / sqrt((1-r^2)^2 + (2*beta*r)^2)
    return theta_r / np.sqrt((1 - r**2)**2 + (2 * beta * r)**2)

# 4. Phase-Frequency Response
def phase_freq_response(r, beta):
    # phi = -arctan(2*beta*r / (1-r^2))
    return -np.degrees(np.arctan2(2 * beta * r, 1 - r**2))

# --- Curve Fitting ---

# Fit 1: Free Vibration
popt_free, _ = curve_fit(poly_func, theta_free, T_free)
T_fit = poly_func(theta_free, *popt_free)

# Fit 2: Damped Vibration
popt_damp, _ = curve_fit(exp_decay, t_damp, theta_damp, p0=[170, 0.05])
delta_damp = popt_damp[1]
theta_fit_damp = exp_decay(t_damp, *popt_damp)

# Fit 3: Forced Amplitude
popt_amp, _ = curve_fit(amp_freq_response, r_freq, theta_forced, p0=[150, 0.05])
theta_r_fit = popt_amp[0]
beta_amp_fit = popt_amp[1]
theta_fit_amp = amp_freq_response(r_freq, *popt_amp)

# Fit 4: Forced Phase
popt_phase, _ = curve_fit(phase_freq_response, r_freq, phi_forced, p0=[0.05])
beta_phase_fit = popt_phase[0]
phi_fit_phase = phase_freq_response(r_freq, *popt_phase)

# --- Plotting & Residual Analysis ---

fig, axs = plt.subplots(4, 2, figsize=(14, 16))

# 1. Free Vibration Plot
axs[0, 0].plot(theta_free, T_free, 'bo', label='Raw Data')
axs[0, 0].plot(theta_free, T_fit, 'r-', label='Poly Fit (2nd Order)')
axs[0, 0].set_title('Free Vibration: Amplitude vs Period')
axs[0, 0].set_xlabel('Amplitude $\\theta$ ($^\circ$)')
axs[0, 0].set_ylabel('Period $T$ (s)')
axs[0, 0].legend()
axs[0, 0].grid(True)

# 1. Free Vibration Residuals
axs[0, 1].plot(theta_free, T_free - T_fit, 'ro')
axs[0, 1].axhline(0, color='k', linestyle='--', alpha=0.5)
axs[0, 1].set_title('Free Vibration Residuals')
axs[0, 1].set_xlabel('Amplitude $\\theta$ ($^\circ$)')
axs[0, 1].set_ylabel('Residual $T_{meas} - T_{fit}$ (s)')
axs[0, 1].grid(True)

# 2. Damped Vibration Plot
t_smooth = np.linspace(0, t_damp[-1], 100)
axs[1, 0].plot(t_damp, theta_damp, 'bo', label='Raw Data')
axs[1, 0].plot(t_smooth, exp_decay(t_smooth, *popt_damp), 'r-', label=f'Exp Fit: $\\delta$={delta_damp:.5f} $s^{{-1}}$')
axs[1, 0].set_title('Damped Vibration: Amplitude Decay')
axs[1, 0].set_xlabel('Time $t$ (s)')
axs[1, 0].set_ylabel('Amplitude $\\theta$ ($^\circ$)')
axs[1, 0].legend()
axs[1, 0].grid(True)

# 2. Damped Vibration Residuals
axs[1, 1].plot(t_damp, theta_damp - theta_fit_damp, 'ro')
axs[1, 1].axhline(0, color='k', linestyle='--', alpha=0.5)
axs[1, 1].set_title('Damped Vibration Residuals')
axs[1, 1].set_xlabel('Time $t$ (s)')
axs[1, 1].set_ylabel('Residual $\\theta_{{meas}} - \\theta_{{fit}}$ ($^\circ$)')
axs[1, 1].grid(True)

# 3. Forced Amplitude Plot
r_smooth = np.linspace(min(r_freq), max(r_freq), 200)
axs[2, 0].plot(r_freq, theta_forced, 'bo', label='Raw Data')
axs[2, 0].plot(r_smooth, amp_freq_response(r_smooth, *popt_amp), 'r-', label=f'Theory Fit: $\\beta$={beta_amp_fit:.4f}')
axs[2, 0].set_title('Forced Vibration: Amplitude-Frequency Characteristic')
axs[2, 0].set_xlabel('Frequency Ratio $\\omega/\\omega_0$')
axs[2, 0].set_ylabel('Amplitude $\\theta$ ($^\circ$)')
axs[2, 0].legend()
axs[2, 0].grid(True)

# 3. Forced Amplitude Residuals
axs[2, 1].plot(r_freq, theta_forced - theta_fit_amp, 'ro')
axs[2, 1].axhline(0, color='k', linestyle='--', alpha=0.5)
axs[2, 1].set_title('Amplitude-Frequency Residuals')
axs[2, 1].set_xlabel('Frequency Ratio $\\omega/\\omega_0$')
axs[2, 1].set_ylabel('Residual $\\theta_{{meas}} - \\theta_{{fit}}$ ($^\circ$)')
axs[2, 1].grid(True)

# 4. Forced Phase Plot
axs[3, 0].plot(r_freq, phi_forced, 'bo', label='Raw Data')
axs[3, 0].plot(r_smooth, phase_freq_response(r_smooth, *popt_phase), 'r-', label=f'Theory Fit: $\\beta$={beta_phase_fit:.4f}')
axs[3, 0].set_title('Forced Vibration: Phase-Frequency Characteristic')
axs[3, 0].set_xlabel('Frequency Ratio $\\omega/\\omega_0$')
axs[3, 0].set_ylabel('Phase Difference $\\phi$ ($^\circ$)')
axs[3, 0].legend()
axs[3, 0].grid(True)

# 4. Forced Phase Residuals
axs[3, 1].plot(r_freq, phi_forced - phi_fit_phase, 'ro')
axs[3, 1].axhline(0, color='k', linestyle='--', alpha=0.5)
axs[3, 1].set_title('Phase-Frequency Residuals')
axs[3, 1].set_xlabel('Frequency Ratio $\\omega/\\omega_0$')
axs[3, 1].set_ylabel('Residual $\\phi_{{meas}} - \\phi_{{fit}}$ ($^\circ$)')
axs[3, 1].grid(True)

plt.tight_layout()
plt.show()

# --- Output Results ---
print("--- Fitting Results ---")
print(f"1. Free Vibration (T = a*theta^2 + b*theta + c):")
print(f"   a = {popt_free[0]:.2e}, b = {popt_free[1]:.2e}, c = {popt_free[2]:.4f}")
print(f"\n2. Damped Vibration (Exponential Decay):")
print(f"   Damping Coefficient delta = {delta_damp:.5f} s^-1")
print(f"   Initial Amplitude A = {popt_damp[0]:.2f} deg")
print(f"\n3. Forced Amplitude (Resonance Curve):")
print(f"   Resonance Amplitude theta_r = {theta_r_fit:.2f} deg")
print(f"   Damping Ratio beta = {beta_amp_fit:.5f}")
print(f"   (Calculated delta = beta * omega0 = {beta_amp_fit * (2*np.pi/T0):.5f} s^-1)")
print(f"\n4. Forced Phase (Phase Curve):")
print(f"   Damping Ratio beta = {beta_phase_fit:.5f}")
print(f"   (Calculated delta = beta * omega0 = {beta_phase_fit * (2*np.pi/T0):.5f} s^-1)")
