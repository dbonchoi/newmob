export type CloseRequestedEvent = {
  preventDefault: () => void;
};

class MockWindow {
  async onCloseRequested(_handler: (event: CloseRequestedEvent) => void | Promise<void>): Promise<() => void> {
    return () => {};
  }
}

const mockWindow = new MockWindow();

export function getCurrentWindow(): MockWindow {
  return mockWindow;
}

export function appWindow(): MockWindow {
  return mockWindow;
}
