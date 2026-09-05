/**
 * Deterministic coding bootstrap when Bharath weights are unavailable.
 * Specialists may still generate content; tools write into CodingWorkspace.
 */

import { goalRequiresRealTests } from "./implementation-gate.js";

export type BootstrapKind = "project_o" | "website" | "school_management";
export { schoolManagementProjectFiles } from "./school-management-project.js";

export function isSchoolManagementGoal(goal: string): boolean {
  return (
    /\bschool\s+management\b/i.test(goal) ||
    /\b(?:college|collage|university)\s+management\b/i.test(goal) ||
    /\b(?:school|college|collage)\s+management\s+project\b/i.test(goal) ||
    /\bmanagement\s+system\b/i.test(goal)
  );
}

export function isProjectOGoal(goal: string): boolean {
  return (
    /\bocean temperature\b/i.test(goal) ||
    /\bproject\s+o\b/i.test(goal) ||
    /\bbuild a model\b/i.test(goal)
  );
}

/** Fix common website typos before goal matching (e.g. "we site" → "website"). */
export function normalizeWebsiteGoalTypos(goal: string): string {
  return goal
    .replace(/\bwe\s+site\b/gi, "website")
    .replace(/\bweb\s+sit\b/gi, "website")
    .replace(/\bwebiste\b/gi, "website")
    .replace(/\bwebsit\b/gi, "website")
    .replace(/\bwbesite\b/gi, "website")
    .replace(/\bwbsite\b/gi, "website")
    .replace(/\bweb\s*site\b/gi, "website");
}

export function isWebsiteGoal(goal: string): boolean {
  const g = normalizeWebsiteGoalTypos(goal);
  return (
    /\b(make|create|build|need)\s+(?:to\s+)?(?:make\s+)?(?:a\s+)?(?:website|web\s*app|landing\s*page|html\s*page|static\s*site)\b/i.test(
      g,
    ) ||
    /\bwebsite\s+for\b/i.test(g) ||
    /\b(make|create|build)\s+(?:a\s+)?site\s+for\b/i.test(g)
  );
}

/** Small REST API acceptance goals — prefer minimal Express stack over full page frameworks. */
export function isSimpleRestApiGoal(goal: string): boolean {
  if (isSchoolManagementGoal(goal)) return false;
  return /\bREST API\b/i.test(goal) && goalRequiresRealTests(goal);
}

export function resolveBootstrapKind(
  goal: string,
  answers?: Record<string, string>,
): BootstrapKind | null {
  const answerText = answers
    ? Object.entries(answers)
        .filter(([k]) => !k.startsWith("__"))
        .map(([, v]) => v)
        .join(" ")
    : "";
  const combined = `${goal} ${answers?.__user_clarification ?? ""} ${answers?.__plan_amendment ?? ""} ${answerText}`;

  if (isProjectOGoal(combined)) return "project_o";
  // School management wins over generic "website" when both appear (e.g. "website for school management")
  if (isSchoolManagementGoal(combined)) return "school_management";
  if (isWebsiteGoal(goal) || isWebsiteGoal(combined)) return "website";
  return null;
}

/** Follow-up fix/add requests against an existing workspace. */
export function isProjectRevisionRequest(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b(add|missing|don't have|doesn't have|do not have|not having|need|fix|change|update|implement|include|without)\b/.test(
      m,
    ) &&
    /\b(role|rbac|auth|login|access|feature|module|admin|teacher|student|parent)\b/.test(m)
  );
}

export function inferRevisionBootstrapKind(
  message: string,
  history: Array<{ role: string; content: string }>,
): BootstrapKind | null {
  const combined = [message, ...history.slice(-8).map((h) => h.content)].join("\n");
  return resolveBootstrapKind(combined);
}

/** Templates only for quick-start / demo / small website / Project O — never default FULL_APPLICATION. */
export function isDemoOrQuickStart(
  goal: string,
  answers?: Record<string, string>,
): boolean {
  const text = `${goal} ${Object.values(answers ?? {}).join(" ")}`.toLowerCase();
  return (
    /\b(quick[- ]?start|demo mode|demo scaffold|template only|static template)\b/.test(text) ||
    /\bscaffold (only|please)\b/.test(text)
  );
}

export function shouldUseTemplateBootstrap(
  kind: BootstrapKind | null,
  goal: string,
  answers?: Record<string, string>,
): boolean {
  if (!kind) return false;
  if (kind === "website" || kind === "project_o") return true;
  if (kind === "school_management") return isDemoOrQuickStart(goal, answers);
  return false;
}

export function isProjectResumeRequest(goal: string): boolean {
  return /\b(continue|resume|pick up|keep going)\b/i.test(goal) &&
    /\b(project|school|workspace|management)\b/i.test(goal);
}

export function shouldCodingBootstrap(
  goal: string,
  need?: { coding?: boolean },
): boolean {
  return Boolean(need?.coding || resolveBootstrapKind(goal));
}

export function extractProjectName(goal: string): string {
  const g = normalizeWebsiteGoalTypos(goal);
  const patterns = [
    /\bwebsite\s+for\s+["']?([A-Za-z0-9][\w .-]{0,60}?)(?=\s+and\b|[.,!]|$)/i,
    /\b(?:make|create|build)\s+(?:a\s+)?website\s+(?:for|called|named)\s+["']?([A-Za-z0-9][\w .-]{0,60}?)(?=\s+and\b|[.,!]|$)/i,
    /\b(?:make|create|build)\s+(?:a\s+)?site\s+for\s+["']?([A-Za-z0-9][\w .-]{0,60}?)(?=\s+and\b|[.,!]|$)/i,
    /\bfolder\s+(?:named|called)\s+["']?([A-Za-z0-9][\w .-]{0,40}?)(?=\s+and\b|[.,!]|$)/i,
    /\bproject\s+(?:named|called)\s+["']?([A-Za-z0-9][\w .-]{0,40}?)(?=\s+and\b|[.,!]|$)/i,
    /\b(?:create|make)\s+(?:a\s+)?(?:folder|directory|project)\s+(?:named|called\s+)?["']?([A-Za-z0-9][\w .-]{0,40}?)(?=\s+and\b|[.,!]|$)/i,
    /\bProject\s+([A-Za-z0-9]+)\b/,
  ];
  for (const re of patterns) {
    const m = g.match(re);
    if (m?.[1]) {
      const name = m[1].trim().replace(/[^\w .-]+/g, "").slice(0, 48);
      if (name && !/^(named|called|the|a|an|for)$/i.test(name)) return name;
    }
  }
  if (isWebsiteGoal(g)) return "my-website";
  if (isSchoolManagementGoal(g)) return "school-management";
  return "project";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";
}

/** Minimal static website scaffold (no build step required). */
export function websiteProjectFiles(projectName: string): Array<{ path: string; content: string }> {
  const title = projectName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const slug = slugify(projectName);
  return [
    {
      path: "README.md",
      content: `# ${title}

Static website scaffold created by Personal AI Orchestrate (coding bootstrap).

Pages: Home (\`index.html\`), About (\`about.html\`), Contact (\`contact.html\`).

## Open locally
Open \`index.html\` in your browser, or run:
\`\`\`bash
python3 -m http.server 8080
\`\`\`
Then visit http://localhost:8080

## Honesty
- Files were generated from a template (Bharath weights may be NOT_LOADED).
- Customize copy, colors, and sections before publishing.
`,
    },
    {
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero">
    <nav class="nav">
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="contact.html">Contact</a>
    </nav>
    <p class="eyebrow">Welcome to</p>
    <h1>${title}</h1>
    <p class="lead">A multi-page starter website — Home, About, and Contact. Edit the HTML to make it yours.</p>
    <a class="btn" href="about.html">Learn more</a>
  </header>
  <main id="about" class="section">
    <h2>Home</h2>
    <p>This site was scaffolded by Personal AI as more than a single landing page.</p>
  </main>
  <footer class="footer">
    <p>&copy; <span id="year"></span> ${title}</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>
`,
    },
    {
      path: "about.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>About · ${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero compact">
    <nav class="nav">
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="contact.html">Contact</a>
    </nav>
    <h1>About</h1>
  </header>
  <main class="section">
    <p>Tell visitors who you are. This page exists so the site is not a one-page demo.</p>
  </main>
  <footer class="footer"><p>&copy; ${title}</p></footer>
</body>
</html>
`,
    },
    {
      path: "contact.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contact · ${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero compact">
    <nav class="nav">
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="contact.html">Contact</a>
    </nav>
    <h1>Contact</h1>
  </header>
  <main class="section">
    <form>
      <label>Name <input name="name" required /></label>
      <label>Message <textarea name="message" required></textarea></label>
      <button type="button" class="btn">Send (static demo)</button>
    </form>
  </main>
  <footer class="footer"><p>&copy; ${title}</p></footer>
</body>
</html>
`,
    },
    {
      path: "styles.css",
      content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.6;
  color: #e8eef7;
  background: #0b1220;
}
.hero {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 4rem 8vw;
  background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
}
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; color: #7dd3fc; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); margin: 0.5rem 0 1rem; }
.lead { max-width: 42rem; color: #94a3b8; margin-bottom: 1.5rem; }
.btn {
  display: inline-block;
  padding: 0.75rem 1.25rem;
  border-radius: 0.75rem;
  background: #38bdf8;
  color: #0b1220;
  text-decoration: none;
  font-weight: 600;
}
.section { padding: 3rem 8vw; max-width: 48rem; }
.section h2 { margin-bottom: 0.75rem; color: #7dd3fc; }
.footer { padding: 2rem 8vw; color: #64748b; font-size: 0.875rem; border-top: 1px solid #1e293b; }
.hero.compact { min-height: auto; padding: 2rem 8vw; }
.nav { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
.nav a { color: #7dd3fc; text-decoration: none; }
form label { display: block; margin: 0.75rem 0; }
form input, form textarea { width: 100%; max-width: 28rem; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #334155; background: #0b1220; color: #e8eef7; }
`,
    },
    {
      path: "script.js",
      content: `document.getElementById("year").textContent = String(new Date().getFullYear());
console.log("SITE_SCAFFOLD_OK slug=${slug}");
`,
    },
  ];
}

/** Minimal ocean-temperature demo project (stdlib only — no pip required). */
export function oceanTemperatureProjectFiles(): Array<{ path: string; content: string }> {
  return [
    {
      path: "README.md",
      content: `# Project O — Ocean Temperature Predictor

Synthetic linear model for demonstration.

## Honesty
- CODE_EXECUTION_SUCCESS means the script ran.
- MODEL_QUALITY_NOT_VERIFIED until evaluated on real validated ocean data with reported metrics.
`,
    },
    {
      path: "requirements.txt",
      content: "# stdlib only for the demo predictor\n",
    },
    {
      path: "data/sample.csv",
      content: `latitude,longitude,month,depth_m,temperature_c
0,0,1,10,27.1
10,-30,1,10,26.4
20,-40,6,10,24.8
-10,40,6,10,25.9
30,-60,12,50,18.2
-20,60,12,50,19.5
40,-20,7,100,12.4
-30,120,7,100,14.1
5,-10,3,20,26.8
15,20,9,20,25.2
`,
    },
    {
      path: "model.py",
      content: `"""Project O — synthetic ocean temperature predictor (stdlib only).

CODE_EXECUTION_SUCCESS ≠ MODEL_QUALITY_VERIFIED.
This uses a simple least-squares fit on bundled synthetic samples.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "sample.csv"


def load_rows(path: Path = DATA):
    rows = []
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            rows.append(
                {
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "month": float(row["month"]),
                    "depth_m": float(row["depth_m"]),
                    "temperature_c": float(row["temperature_c"]),
                }
            )
    return rows


def features(row):
    # simple engineered features
    return [
        1.0,
        row["latitude"] / 90.0,
        math.sin(2 * math.pi * row["month"] / 12.0),
        math.cos(2 * math.pi * row["month"] / 12.0),
        row["depth_m"] / 100.0,
    ]


def fit(rows):
    # normal equations for least squares (small n)
    n = len(features(rows[0]))
    xtx = [[0.0] * n for _ in range(n)]
    xty = [0.0] * n
    for row in rows:
        x = features(row)
        y = row["temperature_c"]
        for i in range(n):
            xty[i] += x[i] * y
            for j in range(n):
                xtx[i][j] += x[i] * x[j]
    # Gaussian elimination
    a = [xtx[i][:] + [xty[i]] for i in range(n)]
    for i in range(n):
        pivot = a[i][i]
        if abs(pivot) < 1e-12:
            continue
        for j in range(i, n + 1):
            a[i][j] /= pivot
        for k in range(n):
            if k == i:
                continue
            factor = a[k][i]
            for j in range(i, n + 1):
                a[k][j] -= factor * a[i][j]
    return [a[i][n] for i in range(n)]


def predict(weights, row):
    x = features(row)
    return sum(w * xi for w, xi in zip(weights, x))


def evaluate(rows, weights):
    errs = []
    for row in rows:
        pred = predict(weights, row)
        errs.append((pred - row["temperature_c"]) ** 2)
    rmse = math.sqrt(sum(errs) / len(errs))
    return {"n": len(rows), "rmse": rmse, "dataset": "synthetic_bundled"}


def main():
    rows = load_rows()
    weights = fit(rows)
    metrics = evaluate(rows, weights)
    sample = {"latitude": 12.0, "longitude": -40.0, "month": 4.0, "depth_m": 25.0}
    pred = predict(weights, sample)
    print("CODE_EXECUTION_SUCCESS=true")
    print(f"prediction_c={pred:.3f}")
    print(f"eval_rmse={metrics['rmse']:.4f}")
    print(f"eval_n={metrics['n']}")
    print("MODEL_QUALITY_NOT_VERIFIED=true")
    print("reason=synthetic_data_only_no_external_ocean_validation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`,
    },
    {
      path: "test_model.py",
      content: `import unittest
from model import load_rows, fit, evaluate, predict


class TestOceanModel(unittest.TestCase):
    def test_fit_and_eval(self):
        rows = load_rows()
        self.assertGreaterEqual(len(rows), 5)
        w = fit(rows)
        metrics = evaluate(rows, w)
        self.assertIn("rmse", metrics)
        self.assertLess(metrics["rmse"], 20.0)
        pred = predict(w, rows[0])
        self.assertTrue(isinstance(pred, float))


if __name__ == "__main__":
    unittest.main()
`,
    },
  ];
}
