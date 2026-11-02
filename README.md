# 🎯 MotionTracker by Nightosphere (v2.0)
**GPU-Accelerated Optical Flow Motion Tracker, 4-Pin 3D Surface Pinning & Video Stabilizer for Adobe Premiere Pro (2019–2026+)**

![Premiere Pro](https://img.shields.io/badge/Adobe_Premiere_Pro-2019--2026+-9999FF?style=flat-square&logo=adobepremierepro)
![Version](https://img.shields.io/badge/Version-2.0.0-3ea6ff?style=flat-square)
![Engine](https://img.shields.io/badge/Engine-WebGL_GPU_%2B_Sub--Pixel_LK-9333ea?style=flat-square)
![License](https://img.shields.io/badge/License-Apache_2.0-10b981?style=flat-square)

**MotionTracker by Nightosphere** is a native Adobe CEP panel that brings fast, sub-pixel optical tracking, 3D planar surface pinning, object/ball camera follow, and counter-motion stabilization directly into the **Adobe Premiere Pro** timeline—without round-tripping to After Effects.

---

## ✨ Key Features

### 🚀 Dual-Engine Optical Tracking (WebGL GPU + Sub-Pixel CPU)
* **WebGL Fragment Shader Acceleration:** Parallel normalized cross-correlation (NCC) template matching directly on the GPU.
* **Sub-Pixel Precision (0.02px):** 2D Gaussian center-weighted, edge-aware NCC paired with **Inverse-Compositional Lucas-Kanade (IC-LK)** refinement and Integral Image acceleration.
* **Anti-Drift Anchor Locking:** Velocity-predicted search windows combined with an 88% original anchor / 12% live patch blend to prevent template drift over long clips.
* **6x Pixel Magnifier Loupe & 800% Viewport Zoom:** Fine-tune tracker placement down to half-pixel accuracy with Middle-Click / `Alt`+Drag panning and a dedicated **Zoom P1 (350%)** button.

### 📐 3 Tracking Modes
1. **1-Point Tracking (Position X/Y):** Lock text, callouts, graphics, or overlays onto any moving subject.
2. **2-Point Tracking (2D Position, Scale & Rotation):** Track two reference points simultaneously to automatically compute distance-based scaling and angular rotation.
3. **4-Pin 3D Surface Studio (Planar Perspective & Screen Replacement):**
   * Freely drag 4 corner pins (`UL`, `UR`, `LR`, `LL`) with a live 3x3 perspective grid overlay.
   * **1-Click Surface Presets:** Instant quad placement for **16:9 TV**, **9:16 Phone**, **4:3 Sign**, and **3D Tilt**.
   * Automatically bakes keyframes to **Corner Pin** (`Upper Left`, `Upper Right`, `Lower Left`, `Lower Right`), **Basic 3D** (`Swivel` Yaw & `Tilt` Pitch), and anisotropic **Scale Width / Scale Height**.

### 🎥 Specialized Timeline Modes
* **⚽ Camera Follow Mode (Auto-Reframing):** Keeps
