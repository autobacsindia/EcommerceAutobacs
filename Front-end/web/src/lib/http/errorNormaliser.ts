import { ApiError, ErrorCategory } from '../api-types';

export function categorizeError(status: number, error: any): ErrorCategory {
  if (
    error instanceof TypeError &&
    (error.message.includes('fetch') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError'))
  ) {
    return ErrorCategory.NETWORK;
  }
  if (status === 401 || status === 403) return ErrorCategory.AUTH;
  if (status >= 400 && status < 500) return ErrorCategory.CLIENT;
  if (status >= 500 && status < 600) return ErrorCategory.SERVER;
  if (error instanceof DOMException && error.name === 'TimeoutError') return ErrorCategory.TIMEOUT;
  if (error instanceof SyntaxError) return ErrorCategory.PARSING;
  return ErrorCategory.NETWORK;
}

export async function normaliseResponse(response: Response): Promise<any> {
  let data: any;
  const contentType = response.headers.get('content-type');

  try {
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
      try { data = JSON.parse(data); } catch { /* keep as text */ }
    }
  } catch {
    data = { message: response.statusText || 'Unknown error occurred' };
  }

  try {
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const resetTime = retryAfter
          ? Date.now() + parseInt(retryAfter) * 1000
          : Date.now() + 900000;
        const message =
          typeof data === 'object' && data.message
            ? data.message
            : 'Too many requests, please try again later';
        throw new ApiError(response.status, message, response.url, ErrorCategory.CLIENT, {
          retryAfter: retryAfter ? parseInt(retryAfter) : 900,
          resetTime,
        });
      }

      let errorMessage: string =
        typeof data === 'object' && data.message
          ? data.message
          : typeof data === 'string'
          ? data
          : response.statusText || 'An error occurred';

      let category: ErrorCategory;
      if (
        response.url?.includes('/location/select') &&
        errorMessage?.toLowerCase().includes('reverse geocode')
      ) {
        errorMessage = 'Failed to reverse geocode coordinates';
        if (errorMessage.toLowerCase().includes('zero results')) {
          category = ErrorCategory.CLIENT;
        } else if (errorMessage.toLowerCase().includes('timeout') || response.status === 408) {
          category = ErrorCategory.TIMEOUT;
        } else if (response.status >= 500) {
          category = ErrorCategory.SERVER;
        } else {
          category = ErrorCategory.CLIENT;
        }
      } else {
        category = categorizeError(response.status, new Error(errorMessage));
      }

      if (typeof data === 'object' && Array.isArray(data.errors)) {
        const validationErrors = data.errors
          .map((err: any) => {
            if (typeof err === 'string') return err;
            if (err.msg) return err.msg;
            if (err.message) return err.message;
            if (err.param && err.msg) return `${err.param}: ${err.msg}`;
            return 'Validation error';
          })
          .join(', ');

        if (validationErrors) {
          const allGeneric = validationErrors
            .split(',')
            .map((m: string) => m.trim().toLowerCase())
            .every((m: string) => m === 'validation error');

          if (!allGeneric) {
            errorMessage = `${errorMessage}: ${validationErrors}`;
          } else {
            errorMessage =
              data.message && data.message !== 'Validation failed'
                ? data.message
                : 'Validation failed. Please check your input and try again.';
          }
        }
      }

      const apiError = new ApiError(response.status, errorMessage, response.url, category);
      apiError.rawData = data;
      apiError.responseStatus = response.status;
      throw apiError;
    }

    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      if (error.message && error.message !== 'signal is aborted without reason') {
        console.debug(`Request intentionally aborted for ${response.url}: ${error.message}`);
      }
      throw error;
    }

    const errorDetails: Record<string, any> = {
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      isApiError: error instanceof ApiError,
    };
    if (error instanceof Error && error.stack) errorDetails.errorStack = error.stack;
    if (error?.status !== undefined) errorDetails.status = error.status;
    if (response?.url) errorDetails.url = response.url;
    if (error?.category) errorDetails.category = error.category;
    if (error?.responseStatus !== undefined) errorDetails.responseStatus = error.responseStatus;
    if (error?.rawData !== undefined) errorDetails.rawData = error.rawData;

    const url = response?.url ?? '';
    const is404 = error?.status === 404 || response.status === 404;
    const isApiError404 = error instanceof ApiError && error.status === 404;
    const shouldSuppressLog =
      ((url.includes('/location/current') ||
        url.includes('/categories/slug/') ||
        url.includes('/vehicles/slug/') ||
        url.includes('/products/slug/')) &&
        (is404 || isApiError404)) ||
      url.includes('/products/by-vehicle/') ||
      (typeof errorDetails.errorMessage === 'string' &&
        (errorDetails.errorMessage.includes('Invalid ID format') ||
          errorDetails.errorMessage.includes('Cast to ObjectId failed') ||
          errorDetails.errorMessage.includes('Cannot mark order as failed') ||
          errorDetails.errorMessage.includes('cannot be cancelled') ||
          errorDetails.errorMessage.includes('Order already in terminal state'))) ||
      error?.status === 401 ||
      response.status === 401;

    const isRateLimitError = error?.status === 429 || response.status === 429;

    if (!shouldSuppressLog && process.env.NODE_ENV !== 'test') {
      if (!isRateLimitError) {
        console.error(
          `API Response Error [${errorDetails.status || error?.status || 'unknown'}] ${url}:`,
          errorDetails
        );
      } else {
        console.warn('Rate limit hit:', errorDetails);
      }
    }

    if (error instanceof SyntaxError) {
      throw new ApiError(0, 'Invalid response format', response.url, ErrorCategory.PARSING);
    }
    if (error instanceof ApiError) throw error;

    const category = categorizeError(response.status, error);
    let errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'An unknown error occurred';

    if (category === ErrorCategory.NETWORK) {
      errorMessage = `Network error: Unable to connect to the server. Please make sure the backend server is running. Details: ${errorMessage}`;
    }

    const apiError = new ApiError(response.status || 0, errorMessage, response.url || '', category);
    apiError.originalError = error;
    throw apiError;
  }
}
