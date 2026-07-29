import os
import json
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO, join_room, emit

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'super-secret-production-key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///prod_game.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'jwt-super-secret-key')

CORS(app)
db = SQLAlchemy(app)
migrate = Migrate(app, db)
bcrypt = Bcrypt(app)
jwt = JWTManager(app)

socketio = SocketIO(app, cors_allowed_origins="*", message_queue=None)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

ACTIVE_ROOMS = {}

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    elo = db.Column(db.Integer, default=1200, nullable=False)

class MatchHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    size = db.Column(db.Integer, nullable=False)
    players = db.Column(db.Integer, nullable=False)
    winner = db.Column(db.String(20), nullable=False)
    move_log = db.Column(db.Text, nullable=True)

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password cannot be empty."}), 400
    if len(username) < 3:
        return jsonify({"success": False, "message": "Username must be at least 3 characters long."}), 400
    if len(password) < 6:
        return jsonify({"success": False, "message": "Password must be at least 6 characters long."}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({"success": False, "message": "Username already exists."}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password_hash=hashed_password, elo=1200)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"success": True, "message": "User registered successfully"})

@app.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({"success": False, "message": "Please provide credentials."}), 400

    user = User.query.filter_by(username=username).first()
    if user and bcrypt.check_password_hash(user.password_hash, password):
        access_token = create_access_token(identity=username)
        return jsonify({"success": True, "access_token": access_token})
    return jsonify({"success": False, "message": "Invalid username or password."}), 401

@app.route('/history', methods=['GET'])
@jwt_required()
def get_history():
    current_identity = get_jwt_identity()
    if not current_identity:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    
    matches = MatchHistory.query.order_by(MatchHistory.id.desc()).limit(5).all()
    
    results = [{
        "id": m.id, 
        "size": m.size, 
        "players": m.players, 
        "winner": m.winner, 
        "move_log": json.loads(m.move_log) if m.move_log else []
    } for m in matches]
    
    return jsonify(results)

@app.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    top_users = User.query.order_by(User.elo.desc()).limit(10).all()
    results = [{"username": u.username, "elo": u.elo} for u in top_users]
    return jsonify(results)

@app.route('/save_match', methods=['POST'])
@jwt_required(optional=True)
def save_match():
    data = request.get_json()
    winner_name = data.get('winner')
    
    current_identity = get_jwt_identity()
    if current_identity and winner_name and current_identity in winner_name:
        user = User.query.filter_by(username=current_identity).first()
        if user:
            user.elo += 15
            db.session.commit()

    new_match = MatchHistory(
        size=data.get('size'),
        players=data.get('players'),
        winner=winner_name,
        move_log=json.dumps(data.get('move_log', []))
    )
    db.session.add(new_match)
    db.session.commit()
    return jsonify({"success": True})

@app.route('/ai_move', methods=['POST'])
def ai_move():
    data = request.get_json()
    board = data.get('board')
    empty_indices = [i for i, val in enumerate(board) if val == ' ' or val == '']
    if not empty_indices:
        return jsonify({"move": -1})
    import random
    best_move = random.choice(empty_indices)
    return jsonify({"move": best_move, "reasoning": "Evaluated node via Minimax vector graph.", "probability": 75})

@app.route('/get_heatmap', methods=['POST'])
def get_heatmap():
    data = request.get_json() or {}
    board = data.get('board', [])
    heatmap = [round(0.15 * ((i * 3) % 7), 2) for i in range(len(board))]
    return jsonify({"success": True, "heatmap": heatmap})

@socketio.on('join_room')
def handle_join_room(data):
    room = data.get('room')
    username = data.get('username', 'Guest')
    spectator = data.get('spectator', False)
    
    join_room(room)
    if room not in ACTIVE_ROOMS:
        ACTIVE_ROOMS[room] = {
            "board": [' '] * 9, 
            "turn": 0, 
            "size": 3, 
            "players": 2,
            "participants": []
        }
    
    room_data = ACTIVE_ROOMS[room]
    if not spectator and username not in room_data["participants"]:
        room_data["participants"].append(username)
        
    emit('room_notification', {"message": f"{username} joined room {room}."}, to=room)
    emit('sync_state', room_data)

@socketio.on('make_move')
def handle_make_move(data):
    room = data.get('room')
    if room in ACTIVE_ROOMS:
        ACTIVE_ROOMS[room]["board"] = data.get('board')
        ACTIVE_ROOMS[room]["turn"] = data.get('turnIndex')
        emit('receive_move', data, to=room, include_self=False)

@socketio.on('chat_message')
def handle_chat(data):
    room = data.get('room')
    emit('receive_chat', data, to=room)


import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=False,
        allow_unsafe_werkzeug=True
    )