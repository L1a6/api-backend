class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function isApiError(error) {
  return error instanceof ApiError;
}

module.exports = {
  ApiError,
  isApiError
};
