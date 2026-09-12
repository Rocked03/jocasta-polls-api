import ApiError from "./ApiError";

export default class NotImplementedError extends ApiError {
  constructor(message = "Not implemented") {
    super(message, 501);
  }
}
