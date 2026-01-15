import trackingService from "@/services/trackingService";
import apiClient from "@/lib/api";

jest.mock("@/lib/api", () => {
  const get = jest.fn();
  const post = jest.fn();
  return {
    __esModule: true,
    default: { get, post },
  };
});

const mockedApiClient = apiClient as any;

describe("trackingService", () => {
  beforeEach(() => {
    mockedApiClient.get.mockReset();
    mockedApiClient.post.mockReset();
  });

  it("trackByNumber calls /orders/track/:trackingNumber", async () => {
    const trackingNumber = "ABC123456789";
    const data = { success: true, trackingNumber };

    mockedApiClient.get.mockResolvedValue(data);

    const result = await trackingService.trackByNumber(trackingNumber);

    expect(mockedApiClient.get).toHaveBeenCalledWith(
      `/orders/track/${trackingNumber}`
    );
    expect(result).toEqual(data);
  });

  it("getCarriers calls /orders/tracking/carriers", async () => {
    const data = { success: true, carriers: [] };

    mockedApiClient.get.mockResolvedValue(data);

    const result = await trackingService.getCarriers();

    expect(mockedApiClient.get).toHaveBeenCalledWith(
      "/orders/tracking/carriers"
    );
    expect(result).toEqual(data);
  });

  it("getTrackingHistory calls /orders/:id/tracking", async () => {
    const orderId = "order123";
    const data = { success: true, trackingNumber: "TRACK123" };

    mockedApiClient.get.mockResolvedValue(data);

    const result = await trackingService.getTrackingHistory(orderId);

    expect(mockedApiClient.get).toHaveBeenCalledWith(
      `/orders/${orderId}/tracking`
    );
    expect(result).toEqual(data);
  });

  it("addTracking posts to /orders/:id/tracking", async () => {
    const orderId = "order123";
    const payload = { carrierCode: "delhivery", trackingNumber: "TRACK123" };
    const data = { success: true };

    mockedApiClient.post.mockResolvedValue(data);

    const result = await trackingService.addTracking(orderId, payload);

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      `/orders/${orderId}/tracking`,
      payload
    );
    expect(result).toEqual(data);
  });

  it("addTrackingEvent posts to /orders/:id/tracking/events", async () => {
    const orderId = "order123";
    const event = { status: "in_transit" };
    const data = { success: true };

    mockedApiClient.post.mockResolvedValue(data);

    const result = await trackingService.addTrackingEvent(orderId, event);

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      `/orders/${orderId}/tracking/events`,
      event
    );
    expect(result).toEqual(data);
  });

  it("validateTrackingNumber validates format", () => {
    const valid = trackingService.validateTrackingNumber("ABC123456789");
    const empty = trackingService.validateTrackingNumber("");
    const short = trackingService.validateTrackingNumber("ABC123");
    const long = trackingService.validateTrackingNumber("A".repeat(26));
    const invalidChars = trackingService.validateTrackingNumber("ABC123-456");

    expect(valid.valid).toBe(true);
    expect(empty.valid).toBe(false);
    expect(short.valid).toBe(false);
    expect(long.valid).toBe(false);
    expect(invalidChars.valid).toBe(false);
  });
}
);

