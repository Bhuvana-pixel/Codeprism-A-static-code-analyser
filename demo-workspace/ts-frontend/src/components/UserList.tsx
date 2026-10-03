import React, { useEffect, useState } from 'react';
import { ApiClient, User } from '../api/client';

export const UserList: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    const client = new ApiClient();
    client.fetchUsers().then(data => setUsers(data));
  }, []);

  return (
    <div className="user-list">
      <h2>CodePrism User Directory</h2>
      <ul>
        {users.map(u => (
          <li key={u.id}>{u.name} ({u.email})</li>
        ))}
      </ul>
    </div>
  );
};
