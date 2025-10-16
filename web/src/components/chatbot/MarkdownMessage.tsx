import { Fragment, ReactElement, ReactNode, useMemo } from "react";

type MarkdownMessageProps = {
  content: string;
};

type InlineRenderOptions = {
  keyPrefix: string;
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, index) => (
        <Fragment key={`block-${index}`}>{block}</Fragment>
      ))}
    </div>
  );
}

function parseMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactElement[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const { node, nextIndex } = parseCodeBlock(lines, index);
      elements.push(node);
      index = nextIndex;
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const { node, nextIndex } = parseHeading(lines, index);
      elements.push(node);
      index = nextIndex;
      continue;
    }

    if (/^>/.test(line.trimStart())) {
      const { node, nextIndex } = parseBlockQuote(lines, index);
      elements.push(node);
      index = nextIndex;
      continue;
    }

    if (/^(\d+\.\s+|[-*+]\s+)/.test(line.trimStart())) {
      const { node, nextIndex } = parseList(lines, index);
      elements.push(node);
      index = nextIndex;
      continue;
    }

    const { node, nextIndex } = parseParagraph(lines, index);
    elements.push(node);
    index = nextIndex;
  }

  return elements;
}

function parseCodeBlock(lines: string[], startIndex: number) {
  const startLine = lines[startIndex];
  const langMatch = startLine.match(/^```(\w+)?/);
  const language = langMatch?.[1];
  const codeLines: string[] = [];

  let index = startIndex + 1;
  while (index < lines.length && !lines[index].startsWith("```")) {
    codeLines.push(lines[index]);
    index += 1;
  }

  if (index < lines.length && lines[index].startsWith("```")) {
    index += 1;
  }

  const code = codeLines.join("\n");

  return {
    node: (
      <pre className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-[13px]">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    ),
    nextIndex: index,
  };
}

function parseHeading(lines: string[], startIndex: number) {
  const line = lines[startIndex];
  const match = line.match(/^(#{1,6})\s+(.*)$/);
  const level = match ? match[1].length : 1;
  const text = match ? match[2] : line;

  const headingClass = headingClassByLevel(level);
  const content = renderInline(text, { keyPrefix: `heading-${startIndex}` });

  return {
    node: (
      <p className={headingClass}>
        {content.map((child, index) => (
          <Fragment key={`heading-${startIndex}-${index}`}>{child}</Fragment>
        ))}
      </p>
    ),
    nextIndex: startIndex + 1,
  };
}

function headingClassByLevel(level: number) {
  switch (level) {
    case 1:
      return "text-base font-semibold";
    case 2:
      return "text-sm font-semibold";
    default:
      return "text-sm font-medium";
  }
}

function parseBlockQuote(lines: string[], startIndex: number) {
  const quoteLines: string[] = [];
  let index = startIndex;

  while (index < lines.length && /^>/.test(lines[index].trimStart())) {
    const text = lines[index].replace(/^>\s?/, "");
    quoteLines.push(text);
    index += 1;
  }

  const inner = renderInline(quoteLines.join(" "), { keyPrefix: `quote-${startIndex}` });

  return {
    node: (
      <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic">
        {inner.map((child, index) => (
          <Fragment key={`quote-${startIndex}-${index}`}>{child}</Fragment>
        ))}
      </blockquote>
    ),
    nextIndex: index,
  };
}

function parseList(lines: string[], startIndex: number) {
  const isOrdered = /^\d+\.\s+/.test(lines[startIndex].trimStart());
  const items: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index].trimStart();
    if (line === "") {
      break;
    }
    if (isOrdered && !/^\d+\.\s+/.test(line)) {
      break;
    }
    if (!isOrdered && !/^[-*+]\s+/.test(line)) {
      break;
    }
    const itemText = line.replace(isOrdered ? /^\d+\.\s+/ : /^[-*+]\s+/, "");
    items.push(itemText);
    index += 1;
  }

  const ListTag = (isOrdered ? "ol" : "ul") as "ol" | "ul";
  const listClass = `${isOrdered ? "list-decimal" : "list-disc"} ml-4 list-outside space-y-1 text-sm`;

  return {
    node: (
      <ListTag className={listClass}>
        {items.map((item, itemIndex) => (
          <li key={`list-${startIndex}-${itemIndex}`} className="marker:text-muted-foreground">
            {renderInline(item, { keyPrefix: `list-${startIndex}-${itemIndex}` }).map((child, innerIndex) => (
              <Fragment key={`list-${startIndex}-${itemIndex}-${innerIndex}`}>{child}</Fragment>
            ))}
          </li>
        ))}
      </ListTag>
    ),
    nextIndex: index,
  };
}

function parseParagraph(lines: string[], startIndex: number) {
  const paragraphLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      break;
    }
    paragraphLines.push(line);
    index += 1;
  }

  const text = paragraphLines.join("\n");

  return {
    node: (
      <p>
        {renderInline(text, { keyPrefix: `paragraph-${startIndex}` }).map((child, innerIndex) => (
          <Fragment key={`paragraph-${startIndex}-${innerIndex}`}>{child}</Fragment>
        ))}
      </p>
    ),
    nextIndex: text ? index : startIndex + 1,
  };
}

function renderInline(text: string, { keyPrefix }: InlineRenderOptions): ReactNode[] {
  const nodes: ReactNode[] = [];
  const textCounter = { value: 0 };
  const pattern =
    /\[([^\]]+)\]\(([^)]+)\)|(`)(.+?)\3|(\*\*|__)(.+?)\5|(\*|_)(.+?)\7|~~(.+?)~~/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let inlineIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      appendTextSegment(nodes, text.slice(lastIndex, match.index), keyPrefix, textCounter);
    }

    if (match[1] && match[2]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${inlineIndex}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {match[1]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${inlineIndex}`}
          className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[13px]"
        >
          {match[4]}
        </code>
      );
    } else if (match[6]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${inlineIndex}`}>
          {renderInline(match[6], { keyPrefix: `${keyPrefix}-strong-${inlineIndex}` })}
        </strong>
      );
    } else if (match[8]) {
      nodes.push(
        <em key={`${keyPrefix}-em-${inlineIndex}`}>
          {renderInline(match[8], { keyPrefix: `${keyPrefix}-em-${inlineIndex}` })}
        </em>
      );
    } else if (match[9]) {
      nodes.push(
        <span key={`${keyPrefix}-del-${inlineIndex}`} className="line-through">
          {renderInline(match[9], { keyPrefix: `${keyPrefix}-del-${inlineIndex}` })}
        </span>
      );
    }

    inlineIndex += 1;
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    appendTextSegment(nodes, text.slice(lastIndex), keyPrefix, textCounter);
  }

  return nodes;
}

function appendTextSegment(
  nodes: ReactNode[],
  segment: string,
  keyPrefix: string,
  counter: { value: number }
) {
  if (!segment) return;
  const parts = segment.split("\n");
  parts.forEach((part, index) => {
    if (part) {
      nodes.push(part);
    }
    if (index < parts.length - 1) {
      nodes.push(<br key={`${keyPrefix}-br-${counter.value}`} />);
      counter.value += 1;
    }
  });
}
