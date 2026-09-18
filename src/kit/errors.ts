export class KitLlmRequiredError extends Error {
  constructor(
    message = 'NovelKit.create({ runtime: "main" }) requires options.llm',
  ) {
    super(message);
    this.name = "KitLlmRequiredError";
  }
}

export class KitWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KitWorkerError";
  }
}

export class KitWorkspaceDisabledError extends Error {
  constructor(
    message = 'NovelKit was created with workspace: false. createBook / switchBook / listBooks require workspace: true',
  ) {
    super(message);
    this.name = "KitWorkspaceDisabledError";
  }
}

export class KitClosedError extends Error {
  constructor(message = "kit is closed") {
    super(message);
    this.name = "KitClosedError";
  }
}
