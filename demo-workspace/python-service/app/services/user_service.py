from app.repositories.user_repo import UserRepository

class UserService:
    def __init__(self):
        self.user_repo = UserRepository()

    def find_user_by_id(self, user_id: str):
        return self.user_repo.get_by_id(user_id)

    def create_new_user(self, name: str, email: str):
        return self.user_repo.save_user(name, email)
