const crlf = String.fromCharCode(13) + String.fromCharCode(10);

type XsbugProperty = {
  name: string;
  value: string;
  flags: {
    value: string;
    delete: boolean;
    enum: boolean;
    set: boolean;
  };
  property?: Array<XsbugProperty>;
};

type XsbugFrame = {
  name: string;
  value: string;
  path?: string;
  line?: number;
};

enum XsbugMessageType {
  Login,
  Frames,
  Local,
  Global,
  Grammer,
  Break,
  Log,
  InstrumentSample,
  Instrument
}

type XsbugMessage = {
  type: XsbugMessageType;
};

type XsbugLoginMessage = {
  name: string;
  value: string;
} & XsbugMessage;

type XsbugFramesMessage = {
  frames: Array<XsbugFrame>;
} & XsbugMessage;

type XsbugLocalMessage = {
  frame: XsbugFrame;
  properties: Array<XsbugProperty>;
} & XsbugMessage;

type XsbugGlobalMessage = {
  global: Array<XsbugProperty>;
} & XsbugMessage;

type XsbugGrammerMessage = {
  grammer: Array<XsbugProperty>;
} & XsbugMessage;

type XsbugBreakMessage = {
  path: string;
  line: number;
  message: string;
} & XsbugMessage;

type XsbugLogMessage = {
  log: string;
} & XsbugMessage;

type XsbugInstrumentSampleMessage = {
  samples: Array<number>;
} & XsbugMessage;

type XsbugInstrumentMessage = {
  instruments: Array<{ name: string; value: string }>;
} & XsbugMessage;

const XsbugParseFrame = (node): XsbugFrame => {
  const frame: XsbugFrame = {
    name: node.attributes.name.value,
    value: node.attributes.value.value
  };
  if (node.attributes.path) {
    frame.path = node.attributes.path.value;
    frame.line = parseInt(node.attributes.line.value);
  }
  return frame;
};

const XsbugParseProperty = (node): XsbugProperty => {
  const flags = node.attributes.flags.value;
  const property: XsbugProperty = {
    name: node.attributes.name.value,
    value: node.attributes.value.value,
    flags: {
      value: flags,
      delete: flags.indexOf('C') < 0,
      enum: flags.indexOf('E') < 0,
      set: flags.indexOf('W') < 0
    }
  };

  if (node.firstChild) {
    property.property = [];
    for (let p = node.firstChild; p; p = p.nextSibling)
      property.property.push(XsbugParseProperty(p));
    property.property.sort((a, b) => a.name.localeCompare(b.name));
  }

  return property;
};

const XsbugTypeParser = {
  login(node): XsbugLoginMessage {
    return {
      type: XsbugMessageType.Login,
      name: node.attributes.name.value,
      value: node.attributes.value.value
    };
  },
  samples(node): XsbugInstrumentSampleMessage {
    return {
      type: XsbugMessageType.InstrumentSample,
      samples: node.textContent.split(',').map(value => parseInt(value))
    };
  },
  frames(node): XsbugFramesMessage {
    let frames = [];
    for (node = node.firstChild; node; node = node.nextSibling) {
      frames.push(XsbugParseFrame(node));
    }
    return {
      type: XsbugMessageType.Frames,
      frames
    };
  },
  local(node): XsbugLocalMessage {
    const frame = XsbugParseFrame(node);
    let properties = [];
    for (node = node.firstChild; node; node = node.nextSibling) {
      properties.push(XsbugParseProperty(node));
    }
    properties.sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: XsbugMessageType.Local,
      frame,
      properties
    };
  },
  global(node): XsbugGlobalMessage {
    const global = [];
    for (node = node.firstChild; node; node = node.nextSibling) {
      global.push(XsbugParseProperty(node));
    }
    global.sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: XsbugMessageType.Global,
      global
    };
  },
  grammar(node): XsbugGrammerMessage {
    const grammer = [];
    for (node = node.firstChild; node; node = node.nextSibling) {
      grammer.push(XsbugParseProperty(node));
    }
    grammer.sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: XsbugMessageType.Grammer,
      grammer
    };
  },
  break(node): XsbugBreakMessage {
    return {
      type: XsbugMessageType.Break,
      path: node.attributes.path.value,
      line: parseInt(node.attributes.line.value),
      message: node.textContent
    };
  },
  log(node): XsbugLogMessage {
    return {
      type: XsbugMessageType.Log,
      log: node.textContent
    };
  },
  instruments(node): XsbugInstrumentMessage {
    let instruments = [];
    for (node = node.firstChild; node; node = node.nextSibling) {
      instruments.push({
        name: node.attributes.name.value,
        value: node.attributes.value.value
      });
    }
    return {
      type: XsbugMessageType.Instrument,
      instruments
    };
  }
};

const XsbugMessageParser = (xml: Document): Array<XsbugMessage> => {
  const root = xml.documentElement;
  if ('xsbug' !== root.nodeName) throw new Error('not xsbug xml');
  const messages = [];
  for (let node: Node = root.firstChild; node; node = node.nextSibling) {
    messages.push(XsbugTypeParser[node.nodeName](node));
  }
  return messages;
};

export default class XsbugConnection {
  private socket: WebSocket;
  private parser: DOMParser;

  constructor(uri: string) {
    this.parser = new DOMParser();
    this.socket = new WebSocket(uri);

    this.socket.onopen = this.onopen.bind(this);
    this.socket.onclose = this.onclose.bind(this);
    this.socket.onerror = this.onerror.bind(this);
    this.socket.onmessage = this.onmessage.bind(this);
  }
  onopen() {
    console.log('WS OPEN');
  }
  onclose() {
    console.log('WS CLOSE');
  }
  onerror() {
    console.log('WS ERROR');
  }
  onmessage(event) {
    console.log('WS RECEIVE ' + event.data);
    const msg = XsbugMessageParser(
      this.parser.parseFromString(event.data, 'application/xml')
    );
    msg.forEach(message => {
      switch (message.type) {
        case XsbugMessageType.Login:
          this.onLogin(message as XsbugLoginMessage);
          break;
        case XsbugMessageType.Log:
          this.onLog(message as XsbugLogMessage);
          break;
        case XsbugMessageType.Break:
          this.onBreak(message as XsbugBreakMessage);
          break;
        case XsbugMessageType.Local:
          this.onLocal(message as XsbugLocalMessage);
          break;
        case XsbugMessageType.Instrument:
          this.onInstrumentationConfigure(message as XsbugInstrumentMessage);
          break;
        case XsbugMessageType.InstrumentSample:
          this.onInstrumentationSamples(
            message as XsbugInstrumentSampleMessage
          );
          break;
        default:
          break;
      }
    });
  }
  send(data) {
    console.log('WS SEND ' + data);
    return this.socket.send(data);
  }
  // transmit message
  doClearBreakpoint(path, line) {
    this.sendCommand(`<clear-breakpoint path="${path}" line="${line}"/>`);
  }
  doGo() {
    this.sendCommand('<go/>');
  }
  doSetBreakpoint(path, line) {
    this.sendCommand(`<set-breakpoint path="${path}" line="${line}"/>`);
  }
  doSelect(value) {
    this.sendCommand(`<select id="${value}"/>`);
  }
  doSetAllBreakpoints(breakpoints = [], exceptions = true, start = false) {
    breakpoints = breakpoints.map(
      b => `<breakpoint path="${b.path}" line="${b.line}"/>`
    );
    if (exceptions)
      breakpoints.unshift('<breakpoint path="exceptions" line="0"/>');
    if (start) breakpoints.unshift('<breakpoint path="start" line="0"/>');
    this.sendCommand(
      `<set-all-breakpoints>${breakpoints.join('')}</set-all-breakpoints>`
    );
  }
  doStep() {
    this.sendCommand('<step/>');
  }
  doStepInside() {
    this.sendCommand('<step-inside/>');
  }
  doStepOutside() {
    this.sendCommand('<step-outside/>');
  }
  doToggle(value) {
    this.sendCommand(`<toggle id="${value}"/>`);
  }
  // receive messages
  onBreak(msg: XsbugBreakMessage) {}
  onLogin(msg: XsbugLoginMessage) {}
  onInstrumentationConfigure(msg: XsbugInstrumentMessage) {}
  onInstrumentationSamples(msg: XsbugInstrumentSampleMessage) {}
  onLocal(msg: XsbugLocalMessage) {}
  onLog(msg: XsbugLogMessage) {}

  // helpers
  sendCommand(msg) {
    this.send(crlf + msg + crlf);
  }
}
