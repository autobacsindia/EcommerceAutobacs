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
}
);

