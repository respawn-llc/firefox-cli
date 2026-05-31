const emptyDataTransferItems: readonly DataTransferItem[] = [];

export function createDomDataTransfer(element: Element): DataTransfer {
  const view = requireElementWindow(element);
  const DataTransferConstructor = view.DataTransfer;
  if (typeof DataTransferConstructor === "function") {
    return new DataTransferConstructor();
  }

  return createLocalDataTransfer();
}

export function createLocalFileList(files: readonly File[]): FileList {
  const list: FileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: () => files.values(),
  };
  for (const [index, file] of files.entries()) {
    Object.defineProperty(list, index, {
      configurable: true,
      enumerable: true,
      value: file,
    });
  }
  return list;
}

export function assignFileInputFiles(input: HTMLInputElement, files: FileList): void {
  try {
    input.files = files;
    return;
  } catch {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
  }
}

export function dispatchDragEventWithDataTransfer(element: Element, type: string, dataTransfer: DataTransfer): void {
  const view = requireElementWindow(element);
  const DragEventConstructor = view.DragEvent;
  const event =
    typeof DragEventConstructor === "function"
      ? new DragEventConstructor(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        })
      : new view.Event(type, {
          bubbles: true,
          cancelable: true,
        });
  if (!("dataTransfer" in event)) {
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      enumerable: true,
      value: dataTransfer,
    });
  }
  element.dispatchEvent(event);
}

function createLocalDataTransfer(): DataTransfer {
  const files: File[] = [];
  const dataTransfer: DataTransfer = {
    dropEffect: "none",
    effectAllowed: "all",
    get files() {
      return createLocalFileList(files);
    },
    items: {
      add: (data: File | string) => {
        if (data instanceof File) {
          files.push(data);
        }
        return null;
      },
      clear: () => {
        files.length = 0;
      },
      get length() {
        return files.length;
      },
      remove: () => undefined,
      [Symbol.iterator]: () => emptyDataTransferItems.values(),
    },
    types: [],
    clearData: () => undefined,
    getData: () => "",
    setData: () => undefined,
    setDragImage: () => undefined,
  };
  return dataTransfer;
}

function requireElementWindow(element: Element): NonNullable<Document["defaultView"]> {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    throw new Error("Document has no window.");
  }
  return view;
}
