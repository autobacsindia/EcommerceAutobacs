import React from 'react';

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <div className="prose max-w-none">
        <p>
          Your privacy is important to us. This policy outlines how we collect, use, and protect your personal information.
        </p>
        <h2 className="text-xl font-semibold mt-6 mb-4">Information We Collect</h2>
        <p>
          We collect information you provide directly to us, such as when you create an account, make a purchase, or contact us for support.
        </p>
        <h2 className="text-xl font-semibold mt-6 mb-4">How We Use Your Information</h2>
        <p>
          We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you.
        </p>
      </div>
    </div>
  );
}
