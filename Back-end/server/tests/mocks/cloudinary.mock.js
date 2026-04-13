/**
 * Cloudinary Mock for Testing
 * 
 * Prevents actual Cloudinary API calls during tests
 * Provides predictable mock responses
 */

const mockUploadResult = {
  public_id: 'test_mock_image_id',
  url: 'https://res.cloudinary.com/test/image/upload/test.jpg',
  secure_url: 'https://res.cloudinary.com/test/image/upload/test.jpg',
  format: 'jpg',
  width: 800,
  height: 600,
  bytes: 123456
};

const mockDestroyResult = {
  result: 'ok'
};

export const cloudinaryMock = {
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn().mockResolvedValue(mockUploadResult),
      destroy: jest.fn().mockResolvedValue(mockDestroyResult),
      upload_stream: jest.fn().mockImplementation((options, callback) => {
        // Simulate stream upload
        callback(null, mockUploadResult);
        return {
          end: jest.fn()
        };
      })
    },
    api: {
      resource: jest.fn().mockResolvedValue(mockUploadResult)
    }
  }
};

/**
 * Reset mock state between tests
 */
export const resetCloudinaryMocks = () => {
  cloudinaryMock.v2.uploader.upload.mockClear();
  cloudinaryMock.v2.uploader.destroy.mockClear();
  cloudinaryMock.v2.uploader.upload_stream.mockClear();
};

/**
 * Simulate Cloudinary upload failure
 */
export const simulateCloudinaryFailure = (errorMessage = 'Upload failed') => {
  cloudinaryMock.v2.uploader.upload.mockRejectedValueOnce(
    new Error(errorMessage)
  );
};

/**
 * Simulate Cloudinary destroy failure
 */
export const simulateDestroyFailure = (errorMessage = 'Destroy failed') => {
  cloudinaryMock.v2.uploader.destroy.mockRejectedValueOnce(
    new Error(errorMessage)
  );
};

export default cloudinaryMock;
