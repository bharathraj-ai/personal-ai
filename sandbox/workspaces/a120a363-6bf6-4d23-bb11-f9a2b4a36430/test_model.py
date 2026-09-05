import unittest
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
