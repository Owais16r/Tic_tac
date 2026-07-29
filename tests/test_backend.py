import pytest
from app import app, db, User, MatchHistory

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
            yield client
        db.drop_all()

def test_register_and_login(client):
    response = client.post('/register', json={
        "username": "testuser",
        "password": "securepassword123"
    })
    assert response.status_code == 200
    data = response.get_json()
    assert data["success"] is True

    response = client.post('/login', json={
        "username": "testuser",
        "password": "securepassword123"
    })
    assert response.status_code == 200
    data = response.get_json()
    assert "access_token" in data

def test_leaderboard_endpoint(client):
    response = client.get('/leaderboard')
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)

def test_ai_move_endpoint(client):
    response = client.post('/ai_move', json={
        "board": [" ", " ", " ", " ", " ", " ", " ", " ", " "],
        "size": 3
    })
    assert response.status_code == 200
    data = response.get_json()
    assert "move" in data
    assert data["move"] != -1