import pytest
from hello import greet

def test_greet_returns_expected_string():
    """Ensure the greet function returns the correct greeting."""
    assert greet() == "Hello, World!"
