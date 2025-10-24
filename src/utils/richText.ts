interface RichTextNode {
  type?: string;
  text?: string;
  content?: (RichTextNode | string)[];
}

const isRichTextNode = (value: unknown): value is RichTextNode =>
  typeof value === 'object' && value !== null;

const lineBreak = '\n';

const pushChild = (
  child: RichTextNode | string,
  buffer: string[],
  depth: number,
  listIndex?: number
) => {
  if (typeof child === 'string') {
    buffer.push(child);
    return;
  }

  collectText(child, buffer, depth, listIndex);
};

const collectText = (node: RichTextNode, buffer: string[], depth = 0, listIndex?: number) => {
  if (!node?.type) {
    return;
  }

  if (node.type === 'text') {
    buffer.push(node.text ?? '');
    return;
  }

  if (node.type === 'hardBreak') {
    buffer.push(lineBreak);
    return;
  }

  if (node.type === 'paragraph') {
    node.content?.forEach((child) => pushChild(child, buffer, depth));
    buffer.push(lineBreak);
    return;
  }

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    node.content?.forEach((item, index) => {
      if (!item) {
        return;
      }
      if (typeof item === 'string') {
        buffer.push(item);
        buffer.push(lineBreak);
        return;
      }
      const prefix = node.type === 'orderedList'
        ? `${'  '.repeat(depth)}${index + 1}. `
        : `${'  '.repeat(depth)}- `;
      buffer.push(prefix);
      collectText(item, buffer, depth + 1, index);
      buffer.push(lineBreak);
    });
    return;
  }

  if (node.type === 'listItem') {
    node.content?.forEach((child) => pushChild(child, buffer, depth, listIndex));
    return;
  }

  node.content?.forEach((child) => pushChild(child, buffer, depth, listIndex));
};

const sanitize = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const richTextToPlain = (node?: RichTextNode | string | null): string => {
  if (!node) {
    return '';
  }

  if (typeof node === 'string') {
    return sanitize(node);
  }

  if (!isRichTextNode(node)) {
    return '';
  }

  const buffer: string[] = [];
  collectText(node, buffer);

  return sanitize(buffer.join(''));
};
