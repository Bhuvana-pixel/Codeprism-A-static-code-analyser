export interface User {
  id: string;
  name: string;
  email: string;
}

export class ApiClient {
  async fetchUsers(): Promise<User[]> {
    return [
      { id: '1', name: 'Alice', email: 'alice@prism.io' },
      { id: '2', name: 'Bob', email: 'bob@prism.io' }
    ];
  }
}
