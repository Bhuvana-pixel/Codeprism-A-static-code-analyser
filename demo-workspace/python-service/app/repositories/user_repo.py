# UserRepository
class UserRepository:
    def __init__(self):
        self.db = {}

    def get_by_id(self, user_id: str):
        return self.db.get(user_id)

    def save_user(self, name: str, email: str):
        user_id = str(len(self.db) + 1)
        user = {"id": user_id, "name": name, "email": email}
        self.db[user_id] = user
        return user
