export class OwnSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnSearchError";
  }
}
