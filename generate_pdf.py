#!/usr/bin/env python3
import subprocess
import os
import re

MD_PATH = "/Users/sabarivasan/Projects/ZYQORA/PROJECT_DOCUMENTATION.md"
HTML_PATH = "/Users/sabarivasan/Projects/ZYQORA/PROJECT_DOCUMENTATION.html"
PDF_PATH = "/Users/sabarivasan/Projects/ZYQORA/PROJECT_DOCUMENTATION.pdf"

# 1. Run pandoc to convert markdown to basic HTML body
cmd = ["pandoc", MD_PATH, "-f", "markdown", "-t", "html5"]
res = subprocess.run(cmd, capture_output=True, text=True, check=True)
raw_html = res.stdout

# 2. Sequence diagram SVG representation for crisp printing
SVG_SEQUENCE_DIAGRAM = """
<div class="diagram-container">
  <div class="diagram-title">System Sequence & Execution Lifecycle</div>
  <svg viewBox="0 0 850 560" class="sequence-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gradHeader" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0284c7"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.1"/>
      </filter>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#0284c7" />
      </marker>
      <marker id="loopArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#059669" />
      </marker>
    </defs>

    <!-- Lifelines -->
    <line x1="80" y1="60" x2="80" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="200" y1="60" x2="200" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="330" y1="60" x2="330" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="460" y1="60" x2="460" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="590" y1="60" x2="590" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="710" y1="60" x2="710" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>
    <line x1="800" y1="60" x2="800" y2="520" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="2"/>

    <!-- Actor / Component Boxes -->
    <g filter="url(#shadow)">
      <rect x="30" y="20" width="100" height="36" rx="6" fill="#0f172a"/>
      <text x="80" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">User / Gamer</text>

      <rect x="155" y="20" width="90" height="36" rx="6" fill="#0369a1"/>
      <text x="200" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">UI & Viewport</text>

      <rect x="285" y="20" width="90" height="36" rx="6" fill="#0369a1"/>
      <text x="330" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">Library IDB</text>

      <rect x="405" y="20" width="110" height="36" rx="6" fill="#0369a1"/>
      <text x="460" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">Emulator Mgr</text>

      <rect x="545" y="20" width="90" height="36" rx="6" fill="#475569"/>
      <text x="590" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">Emscripten VFS</text>

      <rect x="665" y="20" width="90" height="36" rx="6" fill="#7c3aed"/>
      <text x="710" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">PPSSPP WASM</text>

      <rect x="765" y="20" width="70" height="36" rx="6" fill="#d97706"/>
      <text x="800" y="42" fill="#ffffff" font-size="11" font-weight="600" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">GPU / Audio</text>
    </g>

    <!-- Step 1 -->
    <line x1="80" y1="85" x2="200" y2="85" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="140" y="78" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">1. Drag ISO / Select Game</text>

    <!-- Step 2 -->
    <line x1="200" y1="120" x2="330" y2="120" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="265" y="113" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">2. Index & parse metadata</text>

    <!-- Step 3 -->
    <line x1="330" y1="155" x2="460" y2="155" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="395" y="148" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">3. launchGame(blob)</text>

    <!-- Step 4 -->
    <line x1="460" y1="190" x2="800" y2="190" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="630" y="183" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">4. Unlock Web Audio Context on gesture</text>

    <!-- Step 5 -->
    <line x1="460" y1="225" x2="590" y2="225" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="525" y="218" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">5. Mount ISO at /games/game.iso</text>

    <!-- Step 6 -->
    <line x1="460" y1="260" x2="590" y2="260" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="525" y="253" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">6. Write ppsspp.ini & controls.ini</text>

    <!-- Step 7 -->
    <line x1="460" y1="295" x2="710" y2="295" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="585" y="288" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">7. Invoke callMain(["/games/game.iso"])</text>

    <!-- Step 8 -->
    <line x1="710" y1="330" x2="800" y2="330" stroke="#0284c7" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="755" y="323" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#1e293b" text-anchor="middle">8. WebGL 2 Context</text>

    <!-- Loop Box -->
    <rect x="50" y="360" width="770" height="150" rx="8" fill="#f0fdf4" stroke="#86efac" stroke-width="1.5" stroke-dasharray="4 2"/>
    <rect x="50" y="360" width="130" height="22" rx="4" fill="#15803d"/>
    <text x="115" y="375" fill="#ffffff" font-size="9.5" font-weight="700" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">60 FPS GAMEPLAY LOOP</text>

    <line x1="200" y1="400" x2="710" y2="400" stroke="#16a34a" stroke-width="1.8" marker-end="url(#loopArrow)"/>
    <text x="455" y="393" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#166534" text-anchor="middle">9. Poll Gamepad API & Multi-Touch (KeyCode Events)</text>

    <line x1="710" y1="435" x2="710" y2="435" stroke="#16a34a" stroke-width="2"/>
    <text x="710" y="430" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#166534" text-anchor="middle">10. Step Allegrex MIPS + VFPU + HLE Kernel</text>

    <line x1="710" y1="465" x2="800" y2="465" stroke="#16a34a" stroke-width="1.8" marker-end="url(#loopArrow)"/>
    <text x="755" y="458" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#166534" text-anchor="middle">11. Flush WebGL 2 DL & PCM Audio Worklet</text>

    <line x1="710" y1="495" x2="200" y2="495" stroke="#16a34a" stroke-width="1.8" marker-end="url(#loopArrow)"/>
    <text x="455" y="488" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" fill="#166534" text-anchor="middle">12. Update Canvas Viewport & HUD Sparkline Metrics</text>
  </svg>
</div>
"""

# Replace mermaid code block with SVG
html_with_svg = re.sub(r'<pre class="mermaid"><code>.*?</code></pre>', SVG_SEQUENCE_DIAGRAM, raw_html, flags=re.DOTALL)

# 3. Clean and modern CSS for Executive Technical Whitepaper
FULL_HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ZYQORA PSP Web: Technical Project Documentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    @page {{
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
      @bottom-right {{
        content: counter(page);
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 8pt;
        color: #94a3b8;
      }}
      @bottom-left {{
        content: "ZYQORA: Browser-Based PSP Emulator";
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 8pt;
        color: #94a3b8;
      }}
    }}

    *, *::before, *::after {{
      box-sizing: border-box;
    }}

    body {{
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10pt;
      line-height: 1.6;
      color: #1e293b;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }}

    /* Title Page / Header Card */
    .cover-card {{
      background: linear-gradient(135deg, #090d16 0%, #0f172a 60%, #0369a1 100%);
      color: #ffffff;
      padding: 32px 36px;
      border-radius: 12px;
      margin-bottom: 28px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.15);
      page-break-after: avoid;
    }}

    .cover-badge {{
      display: inline-block;
      background: rgba(14, 165, 233, 0.2);
      border: 1px solid rgba(14, 165, 233, 0.4);
      color: #38bdf8;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }}

    .cover-title {{
      font-size: 26pt;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 0 8px 0;
      line-height: 1.15;
      color: #ffffff;
    }}

    .cover-subtitle {{
      font-size: 12.5pt;
      font-weight: 400;
      color: #cbd5e1;
      margin: 0 0 20px 0;
    }}

    .cover-meta {{
      display: flex;
      gap: 24px;
      font-size: 8.5pt;
      color: #94a3b8;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      padding-top: 16px;
    }}

    .meta-item strong {{
      color: #f1f5f9;
      font-weight: 600;
    }}

    /* Headings */
    h1 {{
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 6px;
      margin-top: 30px;
      margin-bottom: 14px;
      page-break-after: avoid;
      break-after: avoid;
    }}

    h2 {{
      font-size: 14pt;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.01em;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-top: 24px;
      margin-bottom: 10px;
      page-break-after: avoid;
      break-after: avoid;
    }}

    h3 {{
      font-size: 11.5pt;
      font-weight: 700;
      color: #0369a1;
      margin-top: 18px;
      margin-bottom: 8px;
      page-break-after: avoid;
      break-after: avoid;
    }}

    p {{
      margin: 0 0 10px 0;
      color: #334155;
    }}

    strong {{
      color: #0f172a;
    }}

    /* Tables */
    table {{
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0 20px 0;
      font-size: 8.5pt;
      page-break-inside: avoid;
      break-inside: avoid;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
    }}

    th {{
      background-color: #0f172a;
      color: #ffffff;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      letter-spacing: 0.02em;
    }}

    td {{
      padding: 7px 12px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
    }}

    tr:nth-child(even) td {{
      background-color: #f8fafc;
    }}

    /* Code Blocks */
    pre {{
      background-color: #0f172a;
      color: #f8fafc;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 8pt;
      line-height: 1.45;
      overflow-x: auto;
      margin: 12px 0 18px 0;
      border: 1px solid #1e293b;
      page-break-inside: avoid;
      break-inside: avoid;
    }}

    code {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 8.5pt;
      background-color: #f1f5f9;
      color: #0284c7;
      padding: 2px 5px;
      border-radius: 4px;
    }}

    pre code {{
      background-color: transparent;
      color: inherit;
      padding: 0;
    }}

    /* Lists */
    ul, ol {{
      margin: 0 0 12px 0;
      padding-left: 20px;
    }}

    li {{
      margin-bottom: 4px;
      color: #334155;
    }}

    /* Diagram Card */
    .diagram-container {{
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      padding: 16px;
      margin: 16px 0 22px 0;
      page-break-inside: avoid;
      break-inside: avoid;
    }}

    .diagram-title {{
      font-size: 10pt;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }}

    .sequence-svg {{
      width: 100%;
      height: auto;
      display: block;
    }}

    /* Links */
    a {{
      color: #0284c7;
      text-decoration: none;
      font-weight: 500;
    }}

    hr {{
      border: 0;
      height: 1px;
      background: #e2e8f0;
      margin: 24px 0;
    }}
  </style>
</head>
<body>

  <div class="cover-card">
    <div class="cover-badge">Architecture & System Specification</div>
    <div class="cover-title">ZYQORA</div>
    <div class="cover-subtitle">Browser-Based PlayStation Portable (PSP) Emulation Platform</div>
    <div class="cover-meta">
      <div class="meta-item"><strong>Core Engine:</strong> WebAssembly (WASM) / WebGL 2.0</div>
      <div class="meta-item"><strong>Target Platform:</strong> Modern Web Browsers</div>
      <div class="meta-item"><strong>Version:</strong> 1.0.0 (Production)</div>
      <div class="meta-item"><strong>Status:</strong> Verified Stable (60 FPS)</div>
    </div>
  </div>

  <div class="content-body">
    {html_with_svg}
  </div>

</body>
</html>
"""

# Write out refined HTML
with open(HTML_PATH, "w", encoding="utf-8") as f:
    f.write(FULL_HTML)

print(f"Generated HTML at {HTML_PATH}")

# 4. Generate PDF via Headless Chrome
chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cmd_pdf = [
    chrome_bin,
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    f"--print-to-pdf={PDF_PATH}",
    HTML_PATH
]

print("Compiling PDF with Google Chrome...")
res_pdf = subprocess.run(cmd_pdf, capture_output=True, text=True)
if os.path.exists(PDF_PATH):
    size_bytes = os.path.getsize(PDF_PATH)
    print(f"SUCCESS: PDF generated at {PDF_PATH} ({size_bytes} bytes)")
else:
    print(f"ERROR: Failed to generate PDF. Stderr: {res_pdf.stderr}")
