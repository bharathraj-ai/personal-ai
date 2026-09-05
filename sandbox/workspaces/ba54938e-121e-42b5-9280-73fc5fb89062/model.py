"""Project O — synthetic ocean temperature predictor (stdlib only).

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
