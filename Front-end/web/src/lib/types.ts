// Define types for our data models

export interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: Category | string;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

export interface ProductSpecification {
  key: string;
  value: string;
  _id?: string;
}

export interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category: Category | string;
  brand?: string;
  images: ProductImage[] | string;
  stock: number;
  sku?: string;
  specifications?: ProductSpecification[] | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export interface Pagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

export interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

// Review interfaces
export interface ReviewUser {
  id: string;
  name: string;
}

export interface ReviewImage {
  url: string;
  alt?: string;
}

export interface Review {
  id: string;
  user: ReviewUser;
  rating: number;
  title?: string;
  comment: string;
  images?: ReviewImage[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  isApproved: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: {
    '5': number;
    '4': number;
    '3': number;
    '2': number;
    '1': number;
  };
}

export interface PaginatedReviews {
  reviews: Review[];
  pagination: Pagination;
}