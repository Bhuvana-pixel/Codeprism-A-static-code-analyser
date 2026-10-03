from fastapi import APIRouter
from app.services.user_service import UserService

router = APIRouter(prefix="/users")

class UserController:
    def __init__(self):
        self.user_service = UserService()

    def get_user(self, user_id: str):
        return self.user_service.find_user_by_id(user_id)

    def create_user(self, name: str, email: str):
        return self.user_service.create_new_user(name, email)
