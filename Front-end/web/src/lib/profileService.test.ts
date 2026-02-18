import profileService from "@/lib/profileService";
import apiClient from "@/lib/api";

jest.mock("@/lib/api", () => {
  const get = jest.fn();
  const put = jest.fn();
  const post = jest.fn();
  const del = jest.fn();
  return {
    __esModule: true,
    default: { get, put, post, delete: del },
  };
});

const mockedApiClient = apiClient as any;

describe("profileService", () => {
  beforeEach(() => {
    mockedApiClient.get.mockReset();
    mockedApiClient.put.mockReset();
  });

  it("getProfile requests /profile and returns user", async () => {
    const user = {
      id: "1",
      name: "Test User",
      email: "test@example.com",
      role: "customer",
      addresses: [],
    };

    mockedApiClient.get.mockResolvedValue({ success: true, user });

    const result = await profileService.getProfile();

    expect(mockedApiClient.get).toHaveBeenCalledWith("/profile");
    expect(result).toEqual(user);
  });

  it("updateProfile sends data to /profile and returns user", async () => {
    const update = { name: "Updated User" };

    const user = {
      id: "1",
      name: "Updated User",
      email: "test@example.com",
      role: "customer",
      addresses: [],
    };

    mockedApiClient.put.mockResolvedValue({
      success: true,
      message: "ok",
      user,
    });

    const result = await profileService.updateProfile(update);

    expect(mockedApiClient.put).toHaveBeenCalledWith("/profile", update);
    expect(result).toEqual(user);
  });

  it("getOrders requests /orders with pagination and maps response", async () => {
    const apiResponse = {
      success: true,
      orders: [],
      pagination: { total: 0, pages: 0, currentPage: 2 },
      count: 0,
    };

    mockedApiClient.get.mockResolvedValue(apiResponse);

    const result = await profileService.getOrders(2, 20);

    expect(mockedApiClient.get).toHaveBeenCalledWith("/orders?page=2&limit=20");
    expect(result).toEqual({
      orders: apiResponse.orders,
      pagination: apiResponse.pagination,
      count: apiResponse.count,
    });
  });

  it("getMyReviews requests /reviews/user and returns reviews", async () => {
    const apiResponse = {
      success: true,
      reviews: [],
      pagination: { total: 0, pages: 0, currentPage: 1 },
      count: 0,
    };

    mockedApiClient.get.mockResolvedValue(apiResponse);

    const result = await profileService.getMyReviews(1, 10);

    expect(mockedApiClient.get).toHaveBeenCalledWith("/reviews/user?page=1&limit=10");
    expect(result).toEqual({
      reviews: apiResponse.reviews,
      pagination: apiResponse.pagination,
      count: apiResponse.count,
    });
  });

  it("getPaymentMethods requests /payment-methods and returns list", async () => {
    const apiResponse = {
      success: true,
      paymentMethods: [{ id: "pm1", last4: "4242" }],
      count: 1,
    };

    mockedApiClient.get.mockResolvedValue(apiResponse);

    const result = await profileService.getPaymentMethods();

    expect(mockedApiClient.get).toHaveBeenCalledWith("/payment-methods");
    expect(result).toEqual({
      paymentMethods: apiResponse.paymentMethods,
      count: apiResponse.count,
    });
  });

  it("addPaymentMethod posts to /payment-methods", async () => {
    const paymentData = { token: "tok_123" };
    const apiResponse = { success: true, id: "pm_123" };

    mockedApiClient.post.mockResolvedValue(apiResponse);

    const result = await profileService.addPaymentMethod(paymentData);

    expect(mockedApiClient.post).toHaveBeenCalledWith("/payment-methods", paymentData);
    expect(result).toEqual(apiResponse);
  });

  it("removePaymentMethod deletes from /payment-methods/:id", async () => {
    const id = "pm_123";
    const apiResponse = { success: true };

    mockedApiClient.delete.mockResolvedValue(apiResponse);

    const result = await profileService.removePaymentMethod(id);

    expect(mockedApiClient.delete).toHaveBeenCalledWith(`/payment-methods/${id}`);
    expect(result).toEqual(apiResponse);
  });

  it("getMyReturnRequests requests /returns/my-returns", async () => {
    const apiResponse = {
      success: true,
      requests: [],
      pagination: { total: 0, pages: 0, currentPage: 1 },
      count: 0,
    };

    mockedApiClient.get.mockResolvedValue(apiResponse);

    const result = await profileService.getMyReturnRequests(1, 10);

    expect(mockedApiClient.get).toHaveBeenCalledWith("/returns/my-returns?page=1&limit=10");
    expect(result).toEqual({
      requests: apiResponse.requests,
      pagination: apiResponse.pagination,
      count: apiResponse.count,
    });
  });

  it("getWalletBalance requests /returns/wallet", async () => {
    const apiResponse = {
      success: true,
      wallet: {
        balance: 100,
        currency: "INR",
        history: [],
      },
    };

    mockedApiClient.get.mockResolvedValue(apiResponse);

    const result = await profileService.getWalletBalance();

    expect(mockedApiClient.get).toHaveBeenCalledWith("/returns/wallet");
    expect(result).toEqual(apiResponse.wallet);
  });
});

