'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { User, Mail, Shield, MapPin, CreditCard, ShoppingCart, Heart, Package, Plus, Edit, X, Star } from 'lucide-react';
import Link from 'next/link';
import profileService from '@/lib/profileService';
import { UserProfile, Address, PaginatedOrders, PaymentMethod, PaginatedUserReviews } from '@/lib/types';

export default function ProfilePage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [orders, setOrders] = useState<PaginatedOrders | null>(null);
  const [reviews, setReviews] = useState<PaginatedUserReviews | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<{
    isVerified: boolean;
    email: string;
    verifiedAt?: string;
  } | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    addresses: [] as Address[]
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [currentReviewsPage, setCurrentReviewsPage] = useState(1);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newAddress, setNewAddress] = useState<Omit<Address, 'isDefault'>>({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India'
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadProfileData();
    }
  }, [isAuthenticated, user]);

  const loadProfileData = async () => {
    try {
      setLoading(true);
      const [profileData, ordersData, reviewsData, paymentMethodsData, verificationData] = await Promise.all([
        profileService.getProfile(),
        profileService.getOrders(currentPage),
        profileService.getMyReviews(currentReviewsPage),
        profileService.getPaymentMethods(),
        apiClient.get<{
          success: boolean;
          isVerified: boolean;
          email: string;
          verifiedAt?: string;
        }>('/auth/verification-status').catch(() => ({ success: false, isVerified: false, email: '' }))
      ]);

      setProfile(profileData);
      setOrders(ordersData);
      setReviews(reviewsData);
      setPaymentMethods(paymentMethodsData.paymentMethods);
      
      if (verificationData.success) {
        setVerificationStatus({
          isVerified: verificationData.isVerified,
          email: verificationData.email,
          verifiedAt: verificationData.verifiedAt
        });
      }

      setFormData({
        name: profileData.name,
        email: profileData.email,
        addresses: profileData.addresses
      });
    } catch (error) {
      console.error('Error loading profile data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    if (profile) {
      setFormData({
        name: profile.name,
        email: profile.email,
        addresses: profile.addresses
      });
    }
  };

  const handleSave = async () => {
    try {
      const updatedProfile = await profileService.updateProfile(formData);
      setProfile(updatedProfile);
      setEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAddressChange = (index: number, field: keyof Address, value: string) => {
    setFormData(prev => {
      const newAddresses = [...prev.addresses];
      newAddresses[index] = {
        ...newAddresses[index],
        [field]: value
      };
      return {
        ...prev,
        addresses: newAddresses
      };
    });
  };

  const handleNewAddressChange = (field: keyof Omit<Address, 'isDefault'>, value: string) => {
    setNewAddress(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addNewAddress = () => {
    const addressToAdd = {
      ...newAddress,
      isDefault: formData.addresses.length === 0
    };
    
    setFormData(prev => ({
      ...prev,
      addresses: [...prev.addresses, addressToAdd]
    }));
    
    setNewAddress({
      fullName: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'India'
    });
    setShowAddAddress(false);
  };

  const removeAddress = (index: number) => {
    setFormData(prev => {
      const newAddresses = [...prev.addresses];
      newAddresses.splice(index, 1);
      return {
        ...prev,
        addresses: newAddresses
      };
    });
  };

  const loadOrders = async (page: number) => {
    try {
      const ordersData = await profileService.getOrders(page);
      setOrders(ordersData);
      setCurrentPage(page);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const loadReviews = async (page: number) => {
    try {
      const reviewsData = await profileService.getMyReviews(page);
      setReviews(reviewsData);
      setCurrentReviewsPage(page);
    } catch (error) {
      console.error('Error loading reviews:', error);
    }
  };

  const handleResendVerification = async () => {
    try {
      setIsResendingVerification(true);
      setResendMessage(null);

      const response: any = await apiClient.post('/auth/resend-verification', {});

      if (response.success) {
        setResendMessage('Verification email sent! Please check your inbox.');
      } else {
        setResendMessage(response.message || 'Failed to send verification email');
      }
    } catch (error) {
      console.error('Error resending verification:', error);
      setResendMessage('Failed to send verification email. Please try again later.');
    } finally {
      setIsResendingVerification(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">My Profile</h1>

        {/* Profile Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="h-10 w-10 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">
                {editing ? (
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="border-b border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  profile?.name
                )}
              </h2>
              <p className="text-gray-600">
                {editing ? (
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="border-b border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  profile?.email
                )}
              </p>
            </div>
          </div>

          {/* Email Verification Status Banner */}
          {verificationStatus && !verificationStatus.isVerified && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-yellow-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-yellow-800">Email Not Verified</h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    Please verify your email address to access all features. Check your inbox for the verification email.
                  </p>
                  {resendMessage && (
                    <p className={`mt-2 text-sm ${
                      resendMessage.includes('sent') ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {resendMessage}
                    </p>
                  )}
                  <button
                    onClick={handleResendVerification}
                    disabled={isResendingVerification}
                    className="mt-3 inline-flex items-center px-3 py-1.5 border border-yellow-300 text-sm font-medium rounded text-yellow-700 bg-yellow-100 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isResendingVerification ? 'Sending...' : 'Resend Verification Email'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {verificationStatus && verificationStatus.isVerified && (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Email Verified ✓</h3>
                  <p className="mt-1 text-sm text-green-700">
                    Your email address has been verified.
                    {verificationStatus.verifiedAt && (
                      <span className="ml-1">
                        (Verified on {new Date(verificationStatus.verifiedAt).toLocaleDateString()})
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {editing ? (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Addresses</h3>
              {formData.addresses.map((address, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 mb-4">
                  <div className="flex justify-between items-start">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Full Name</label>
                        <input
                          type="text"
                          value={address.fullName}
                          onChange={(e) => handleAddressChange(index, 'fullName', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Phone</label>
                        <input
                          type="text"
                          value={address.phone}
                          onChange={(e) => handleAddressChange(index, 'phone', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Address Line 1</label>
                        <input
                          type="text"
                          value={address.addressLine1}
                          onChange={(e) => handleAddressChange(index, 'addressLine1', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
                        <input
                          type="text"
                          value={address.addressLine2 || ''}
                          onChange={(e) => handleAddressChange(index, 'addressLine2', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">City</label>
                        <input
                          type="text"
                          value={address.city}
                          onChange={(e) => handleAddressChange(index, 'city', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">State</label>
                        <input
                          type="text"
                          value={address.state}
                          onChange={(e) => handleAddressChange(index, 'state', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Postal Code</label>
                        <input
                          type="text"
                          value={address.postalCode}
                          onChange={(e) => handleAddressChange(index, 'postalCode', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Country</label>
                        <input
                          type="text"
                          value={address.country}
                          onChange={(e) => handleAddressChange(index, 'country', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => removeAddress(index)}
                      className="ml-4 text-red-500 hover:text-red-700"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}

              {showAddAddress ? (
                <div className="border border-gray-200 rounded-lg p-4 mb-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3">Add New Address</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Full Name</label>
                      <input
                        type="text"
                        value={newAddress.fullName}
                        onChange={(e) => handleNewAddressChange('fullName', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Phone</label>
                      <input
                        type="text"
                        value={newAddress.phone}
                        onChange={(e) => handleNewAddressChange('phone', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Address Line 1</label>
                      <input
                        type="text"
                        value={newAddress.addressLine1}
                        onChange={(e) => handleNewAddressChange('addressLine1', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
                      <input
                        type="text"
                        value={newAddress.addressLine2 || ''}
                        onChange={(e) => handleNewAddressChange('addressLine2', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">City</label>
                      <input
                        type="text"
                        value={newAddress.city}
                        onChange={(e) => handleNewAddressChange('city', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">State</label>
                      <input
                        type="text"
                        value={newAddress.state}
                        onChange={(e) => handleNewAddressChange('state', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Postal Code</label>
                      <input
                        type="text"
                        value={newAddress.postalCode}
                        onChange={(e) => handleNewAddressChange('postalCode', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Country</label>
                      <input
                        type="text"
                        value={newAddress.country}
                        onChange={(e) => handleNewAddressChange('country', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex space-x-2">
                    <button
                      onClick={addNewAddress}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                    >
                      Add Address
                    </button>
                    <button
                      onClick={() => setShowAddAddress(false)}
                      className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddAddress(true)}
                  className="flex items-center text-blue-600 hover:text-blue-800 mb-4"
                >
                  <Plus className="h-5 w-5 mr-1" />
                  Add Address
                </button>
              )}
            </div>
          ) : (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Addresses</h3>
              {profile?.addresses && profile.addresses.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profile.addresses.map((address, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <MapPin className="h-5 w-5 text-gray-400 mt-0.5 mr-2" />
                        <div>
                          <p className="font-medium">{address.fullName}</p>
                          <p className="text-gray-600">{address.addressLine1}</p>
                          {address.addressLine2 && (
                            <p className="text-gray-600">{address.addressLine2}</p>
                          )}
                          <p className="text-gray-600">
                            {address.city}, {address.state} {address.postalCode}
                          </p>
                          <p className="text-gray-600">{address.country}</p>
                          <p className="text-gray-600">Phone: {address.phone}</p>
                          {address.isDefault && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mt-2">
                              Default
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No addresses added yet.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                  Save Changes
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={handleEdit}
                className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </button>
            )}
            {/* Admin Dashboard Link - Only show for admin users */}
            {user?.role === 'admin' && (
              <Link
                href="/admin/dashboard"
                className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition"
              >
                <Shield className="h-4 w-4 mr-2" />
                Admin Dashboard
              </Link>
            )}
            <button
              onClick={logout}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Order History Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center mb-4">
            <Package className="h-5 w-5 text-gray-500 mr-2" />
            <h3 className="text-xl font-semibold text-gray-900">Order History</h3>
          </div>

          {orders && orders.orders.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order ID
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Items
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orders.orders.map((order) => (
                      <tr key={order._id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                          {order._id.substring(0, 8)}...
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ₹{order.totalAmount.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                            order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                            order.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {orders.pagination.totalPages && orders.pagination.totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    Showing page {orders.pagination.currentPage} of {orders.pagination.totalPages}
                  </div>
                  <div className="flex space-x-2">
                    {orders.pagination.hasPrev && (
                      <button
                        onClick={() => loadOrders(currentPage - 1)}
                        className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Previous
                      </button>
                    )}
                    {orders.pagination.hasNext && (
                      <button
                        onClick={() => loadOrders(currentPage + 1)}
                        className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Next
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-500">No orders found.</p>
          )}
        </div>

        {/* My Reviews Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center mb-4">
            <Star className="h-5 w-5 text-gray-500 mr-2" />
            <h3 className="text-xl font-semibold text-gray-900">My Reviews</h3>
          </div>

          {reviews && reviews.reviews.length > 0 ? (
            <>
              <div className="space-y-4">
                {reviews.reviews.map((review) => (
                  <div key={review.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-4">
                        {review.product?.image && (
                          <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                            <img
                              src={review.product.image.url}
                              alt={review.product.image.alt || review.product.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div>
                          <Link href={`/products/${review.product?.id}`} className="font-medium text-blue-600 hover:underline">
                            {review.product?.name || 'Unknown Product'}
                          </Link>
                          <div className="flex items-center mt-1">
                            <div className="flex text-yellow-400">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-4 w-4 ${i < review.rating ? 'fill-current' : 'text-gray-300'}`}
                                />
                              ))}
                            </div>
                            <span className="ml-2 text-sm text-gray-500">
                              {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <h4 className="font-medium mt-2">{review.title}</h4>
                          <p className="text-gray-600 text-sm mt-1">{review.comment}</p>
                          
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              review.isApproved 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {review.isApproved ? 'Approved' : 'Pending Approval'}
                            </span>
                            {review.isVerifiedPurchase && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 flex items-center">
                                <Shield className="h-3 w-3 mr-1" />
                                Verified Purchase
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {review.helpfulCount} found helpful
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {reviews.pagination.totalPages && reviews.pagination.totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    Showing page {reviews.pagination.currentPage} of {reviews.pagination.totalPages}
                  </div>
                  <div className="flex space-x-2">
                    {reviews.pagination.hasPrev && (
                      <button
                        onClick={() => loadReviews(currentReviewsPage - 1)}
                        className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Previous
                      </button>
                    )}
                    {reviews.pagination.hasNext && (
                      <button
                        onClick={() => loadReviews(currentReviewsPage + 1)}
                        className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Next
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-500">No reviews submitted yet.</p>
          )}
        </div>

        {/* Payment Methods Section */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center mb-4">
            <CreditCard className="h-5 w-5 text-gray-500 mr-2" />
            <h3 className="text-xl font-semibold text-gray-900">Saved Payment Methods</h3>
          </div>

          {paymentMethods.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {paymentMethods.map((method) => (
                <div key={method.id} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex items-center">
                    <CreditCard className="h-8 w-8 text-gray-400 mr-3" />
                    <div>
                      <p className="font-medium">
                        {method.card ? `${method.card.brand} ending in ${method.card.last4}` : method.paymentMethod}
                      </p>
                      {method.card && (
                        <p className="text-sm text-gray-500">
                          Expires {method.card.expiryMonth}/{method.card.expiryYear}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        Added on {new Date(method.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => profileService.removePaymentMethod(method.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No saved payment methods.</p>
          )}

          <button className="mt-4 flex items-center text-blue-600 hover:text-blue-800">
            <Plus className="h-5 w-5 mr-1" />
            Add Payment Method
          </button>
        </div>
      </div>
    </div>
  );
}