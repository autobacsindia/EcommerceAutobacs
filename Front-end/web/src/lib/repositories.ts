/**
 * Repository Interfaces - Enterprise Architecture Pattern
 * 
 * This file defines abstract interfaces for data access.
 * Implementations can be swapped (API, mock, offline, mobile, etc.)
 * without changing business logic.
 * 
 * USE CASES:
 * - Mobile app with different API client
 * - Offline mode with local storage
 * - Testing with mock implementations
 * - Multiple backend support (A/B testing, migration)
 */

// ==================== Contact Repository ====================

export interface ContactSubmission {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'replied' | 'closed';
  user?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRepository {
  submit(data: ContactSubmission): Promise<{
    success: boolean;
    message: string;
    data: ContactMessage;
  }>;
  
  getMyMessages(): Promise<{
    success: boolean;
    count: number;
    data: ContactMessage[];
  }>;
  
  getAllMessages(params?: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    success: boolean;
    count: number;
    data: ContactMessage[];
  }>;
  
  reply(id: string, reply: string): Promise<{
    success: boolean;
    data: ContactMessage;
  }>;
  
  updateStatus(id: string, status: 'new' | 'replied' | 'closed'): Promise<{
    success: boolean;
    data: ContactMessage;
  }>;
  
  deleteMessage(id: string): Promise<{
    success: boolean;
    message: string;
  }>;
}

// ==================== Product Repository ====================

export interface Product {
  _id: string;
  name: string;
  price: number;
  // ... other product fields
}

export interface ProductsData {
  products: Product[];
  pagination: {
    total: number;
    pages: number;
    currentPage: number;
  };
}

export interface ProductRepository {
  getAll(params: Record<string, any>): Promise<ProductsData>;
  getById(id: string): Promise<Product | null>;
  getBySlug(slug: string): Promise<Product | null>;
  search(keyword: string, filters: Record<string, any>): Promise<ProductsData>;
  getFeatured(limit?: number): Promise<Product[]>;
}

// ==================== Order Repository ====================

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Order {
  _id: string;
  status: string;
  items: OrderItem[];
  total: number;
  createdAt: string;
}

export interface OrderRepository {
  createOrder(data: any): Promise<{ success: boolean; data: Order }>;
  getOrder(id: string): Promise<Order | null>;
  getUserOrders(params: { page: number; limit: number }): Promise<Order[]>;
  cancelOrder(id: string): Promise<{ success: boolean }>;
  trackOrder(id: string): Promise<any>;
}

// ==================== Implementation Examples ====================

/**
 * API Implementation (Current)
 */
export class ApiContactRepository implements ContactRepository {
  constructor(private apiClient: any) {}

  async submit(data: ContactSubmission) {
    return this.apiClient.post('/contact', data);
  }

  async getMyMessages() {
    return this.apiClient.get('/contact/me');
  }

  async getAllMessages(params?: any) {
    const query = new URLSearchParams(params).toString();
    return this.apiClient.get(`/contact${query ? `?${query}` : ''}`);
  }

  async reply(id: string, reply: string) {
    return this.apiClient.post(`/contact/${id}/reply`, { reply });
  }

  async updateStatus(id: string, status: any) {
    return this.apiClient.patch(`/contact/${id}/status`, { status });
  }

  async deleteMessage(id: string) {
    return this.apiClient.delete(`/contact/${id}`);
  }
}

/**
 * Mock Implementation (Testing)
 */
export class MockContactRepository implements ContactRepository {
  private messages: ContactMessage[] = [];

  async submit(data: ContactSubmission) {
    const message: ContactMessage = {
      _id: `msg_${Date.now()}`,
      ...data,
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.messages.push(message);
    
    return {
      success: true,
      message: 'Message sent',
      data: message
    };
  }

  async getMyMessages() {
    return {
      success: true,
      count: this.messages.length,
      data: this.messages
    };
  }

  async getAllMessages(params?: any) {
    let filtered = this.messages;
    
    if (params?.status) {
      filtered = filtered.filter(m => m.status === params.status);
    }
    
    return {
      success: true,
      count: filtered.length,
      data: filtered
    };
  }

  async reply(id: string, reply: string) {
    const message = this.messages.find(m => m._id === id);
    if (!message) {
      throw new Error('Message not found');
    }
    message.status = 'replied';
    message.updatedAt = new Date().toISOString();
    
    return {
      success: true,
      data: message
    };
  }

  async updateStatus(id: string, status: any) {
    const message = this.messages.find(m => m._id === id);
    if (!message) {
      throw new Error('Message not found');
    }
    message.status = status;
    message.updatedAt = new Date().toISOString();
    
    return {
      success: true,
      data: message
    };
  }

  async deleteMessage(id: string) {
    const index = this.messages.findIndex(m => m._id === id);
    if (index === -1) {
      throw new Error('Message not found');
    }
    this.messages.splice(index, 1);
    
    return {
      success: true,
      message: 'Message deleted'
    };
  }
}

/**
 * Offline Implementation (Future - LocalStorage)
 */
export class OfflineContactRepository implements ContactRepository {
  private readonly STORAGE_KEY = 'offline_contacts';

  private getStoredMessages(): ContactMessage[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  private saveMessages(messages: ContactMessage[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(messages));
  }

  async submit(data: ContactSubmission) {
    const messages = this.getStoredMessages();
    const message: ContactMessage = {
      _id: `offline_${Date.now()}`,
      ...data,
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    messages.push(message);
    this.saveMessages(messages);
    
    return {
      success: true,
      message: 'Message saved offline (will sync when online)',
      data: message
    };
  }

  async getMyMessages() {
    const messages = this.getStoredMessages();
    return {
      success: true,
      count: messages.length,
      data: messages
    };
  }

  async getAllMessages() {
    // Offline mode doesn't support admin view
    return {
      success: true,
      count: 0,
      data: []
    };
  }

  async reply(id: string, reply: string): Promise<{ success: boolean; data: ContactMessage }> {
    throw new Error('Reply not available in offline mode');
  }

  async updateStatus(id: string, status: 'new' | 'replied' | 'closed'): Promise<{ success: boolean; data: ContactMessage }> {
    throw new Error('Status update not available in offline mode');
  }

  async deleteMessage(id: string) {
    const messages = this.getStoredMessages();
    const filtered = messages.filter(m => m._id !== id);
    this.saveMessages(filtered);
    
    return {
      success: true,
      message: 'Message deleted'
    };
  }
}

/**
 * Service Factory - Choose implementation based on environment
 */
export function createContactRepository(mode: 'api' | 'mock' | 'offline' = 'api'): ContactRepository {
  switch (mode) {
    case 'mock':
      return new MockContactRepository();
    case 'offline':
      return new OfflineContactRepository();
    case 'api':
    default:
      // Import apiClient dynamically to avoid circular dependencies
      const apiClient = require('@/lib/api').default;
      return new ApiContactRepository(apiClient);
  }
}
