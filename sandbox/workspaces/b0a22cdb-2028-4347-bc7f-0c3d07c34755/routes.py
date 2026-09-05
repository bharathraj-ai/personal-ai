from flask import Blueprint, jsonify

api_bp = Blueprint('api', __name__)

@api_bp.route('/hello', methods=['GET'])
def hello():
    return jsonify(message="Hello, World!")
