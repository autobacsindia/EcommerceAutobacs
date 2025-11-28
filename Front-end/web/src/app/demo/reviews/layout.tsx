import React from 'react';

export default function ReviewsDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-800">Reviews Component Demo</h1>
          <p className="text-gray-600">Demonstration of the product reviews system</p>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}