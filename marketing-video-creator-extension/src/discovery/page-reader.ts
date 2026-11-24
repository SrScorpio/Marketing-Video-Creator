/**
 * Lector de una pantalla DENTRO del navegador.
 *
 * `readPageForInventory` la serializa Playwright y se ejecuta en la página, así
 * que es autosuficiente a propósito: no usa imports, constantes del módulo ni
 * tipos de DOM (el proyecto compila sin `lib: DOM`, y el navegador pone el DOM
 * en `globalThis.document`).
 *
 * Es de SÓLO LECTURA: no pulsa, no envía formularios, no navega y no escribe.
 *
 * Estrategia de selector, en orden de preferencia:
 *   id → data-testid → aria-label → role+name → css (clase estable o :has-text)
 */

import type {
  DiscoveryElement,
  DiscoveryField,
  DiscoveryForm,
  DiscoveryHeading,
  RawPageSnapshot,
  SelectorStrategy
} from './types';

interface SelectorInfo {
  selector: string;
  strategy: SelectorStrategy;
}

interface SelectorOptions {
  /** Nombre accesible ya calculado (texto visible, aria-label o value). */
  name?: string;
  /** Rol explícito o inferido. Si es '' no se intenta role+name. */
  role?: string;
  /** Etiqueta del elemento (button, a, input...). */
  tag?: string;
}

/**
 * Instantánea cruda de la pantalla actual. Ejecutable en Playwright
 * (`page.evaluate`) y en jsdom (tests), porque no depende del módulo.
 */
export function readPageForInventory(input: { baseUrl: string }): RawPageSnapshot {
  const doc: any = (globalThis as any).document;
  const win: any = (globalThis as any).window;
  const baseUrl: string = input?.baseUrl || (win?.location?.href ?? '');
  const MAX_TEXT = 160;
  const MAX_STATUS = 300;
  const MAX_HEADINGS = 50;
  const MAX_ELEMENTS = 200;

  const STATUS_SELECTOR = [
    '[role="status"]',
    '[role="alert"]',
    '[aria-live]',
    'output',
    '.error',
    '.alert',
    '.toast',
    '.status',
    '.message',
    '.notification'
  ].join(',');

  function clean(value: unknown, max: number = MAX_TEXT): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function attrQuote(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cssEscape(value: string): string {
    if (win?.CSS && typeof win.CSS.escape === 'function') {
      return win.CSS.escape(value);
    }
    return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function tagOf(element: any): string {
    return String(element?.tagName ?? '').toLowerCase();
  }

  function absolute(href: string): string {
    // `win.URL` existe tanto en el navegador como en jsdom; el proyecto compila
    // sin `lib: DOM` para no arrastrar tipos de navegador al host de Node.
    const URLCtor: any = win?.URL ?? (globalThis as any).URL;
    try {
      return new URLCtor(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  function isHidden(element: any): boolean {
    if (!element) {
      return true;
    }
    if (element.hasAttribute?.('hidden')) {
      return true;
    }
    if (element.getAttribute?.('aria-hidden') === 'true') {
      return true;
    }
    if (tagOf(element) === 'input' && (element.getAttribute('type') || '').toLowerCase() === 'hidden') {
      return true;
    }
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const style = win.getComputedStyle(element);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return true;
        }
      } catch {
        /* elemento raro: se considera visible */
      }
    }
    return false;
  }

  function visibleText(element: any): string {
    if (!element) {
      return '';
    }
    return clean(element.innerText || element.textContent || '');
  }

  function labelledByText(element: any): string {
    const ids = clean(element.getAttribute?.('aria-labelledby') || '');
    if (!ids) {
      return '';
    }
    return clean(
      ids
        .split(/\s+/)
        .map((id: string) => doc.getElementById(id))
        .filter(Boolean)
        .map((node: any) => node.textContent || '')
        .join(' ')
    );
  }

  function accessibleName(element: any, text: string): string {
    const aria = clean(element.getAttribute?.('aria-label') || '');
    if (aria) {
      return aria;
    }
    if (text) {
      return text;
    }
    const alt = clean(element.getAttribute?.('alt') || '');
    if (alt) {
      return alt;
    }
    const value = clean(element.getAttribute?.('value') || '');
    if (value) {
      return value;
    }
    return labelledByText(element);
  }

  /** Rol implícito/explícito; '' si el elemento no tiene rol útil. */
  function roleOf(element: any, tag: string): string {
    const explicit = clean(element.getAttribute?.('role') || '');
    if (explicit) {
      return explicit;
    }
    if (tag === 'a') {
      return element.getAttribute('href') ? 'link' : '';
    }
    if (tag === 'button') {
      return 'button';
    }
    if (tag === 'select') {
      return 'combobox';
    }
    if (tag === 'textarea') {
      return 'textbox';
    }
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type)) {
        return 'button';
      }
      if (type === 'checkbox') {
        return 'checkbox';
      }
      if (type === 'radio') {
        return 'radio';
      }
      if (type === 'search') {
        return 'searchbox';
      }
      return 'textbox';
    }
    return '';
  }

  function isStableClass(value: string): boolean {
    if (!value || value.length > 40) {
      return false;
    }
    if (/^(css-|sc-|jsx-|styled-|emotion-|chakra-|MuiBox|tw-)/.test(value)) {
      return false;
    }
    if (/^[a-z]+-[a-z0-9]{6,}$/i.test(value) && /\d/.test(value)) {
      return false;
    }
    return /^[a-zA-Z][\w-]*$/.test(value);
  }

  function stableClassOf(element: any): string {
    const raw = clean(element.getAttribute?.('class') || '', 300);
    if (!raw) {
      return '';
    }
    for (const candidate of raw.split(/\s+/)) {
      if (isStableClass(candidate)) {
        return candidate;
      }
    }
    return '';
  }

  function nthOfType(element: any, tag: string): number {
    let index = 1;
    let sibling = element?.previousElementSibling;
    while (sibling) {
      if (tagOf(sibling) === tag) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  /** Selector por prioridad: id → data-testid → aria-label → role+name → css. */
  function selectorFor(element: any, options: SelectorOptions = {}): SelectorInfo {
    const tag = options.tag || tagOf(element);
    const id = clean(element.getAttribute?.('id') || '');
    if (id) {
      const safe = /^[A-Za-z][\w:.-]*$/.test(id) ? `#${id}` : `[id="${attrQuote(id)}"]`;
      return { selector: safe, strategy: 'id' };
    }

    const testId = clean(element.getAttribute?.('data-testid') || '');
    if (testId) {
      return { selector: `[data-testid="${attrQuote(testId)}"]`, strategy: 'data-testid' };
    }

    const ariaLabel = clean(element.getAttribute?.('aria-label') || '');
    if (ariaLabel) {
      return { selector: `${tag}[aria-label="${attrQuote(ariaLabel)}"]`, strategy: 'aria-label' };
    }

    const name = clean(options.name ?? '');
    const role = options.role ?? roleOf(element, tag);
    if (role && name) {
      return { selector: `role=${role}[name="${attrQuote(name)}"]`, strategy: 'role+name' };
    }

    const cls = stableClassOf(element);
    if (cls) {
      return { selector: `${tag}.${cssEscape(cls)}`, strategy: 'css' };
    }

    if (name) {
      return { selector: `${tag}:has-text("${attrQuote(name)}")`, strategy: 'css' };
    }

    return { selector: `${tag}:nth-of-type(${nthOfType(element, tag)})`, strategy: 'css' };
  }

  function fieldType(control: any): string {
    const tag = tagOf(control);
    if (tag !== 'input') {
      return tag;
    }
    return (control.getAttribute('type') || 'text').toLowerCase();
  }

  function labelOf(control: any): string {
    const id = clean(control.getAttribute?.('id') || '');
    if (id && doc.querySelectorAll) {
      const labels: any[] = Array.from(doc.querySelectorAll('label'));
      for (const label of labels) {
        if (clean(label.getAttribute?.('for') || '') === id) {
          return clean(label.textContent);
        }
      }
    }
    const wrapping = control.closest?.('label');
    if (wrapping) {
      return clean(wrapping.textContent);
    }
    const aria = clean(control.getAttribute?.('aria-label') || '');
    if (aria) {
      return aria;
    }
    const by = labelledByText(control);
    if (by) {
      return by;
    }
    const placeholder = clean(control.getAttribute?.('placeholder') || '');
    if (placeholder) {
      return placeholder;
    }
    return clean(control.getAttribute?.('name') || '', 60);
  }

  function formLabelOf(form: any, index: number): string {
    const aria = clean(form.getAttribute?.('aria-label') || '');
    if (aria) {
      return aria;
    }
    const by = labelledByText(form);
    if (by) {
      return by;
    }
    const legend = form.querySelector?.('legend');
    if (legend) {
      const text = visibleText(legend);
      if (text) {
        return text;
      }
    }
    const id = clean(form.getAttribute?.('id') || '');
    if (id) {
      return id;
    }
    const testId = clean(form.getAttribute?.('data-testid') || '');
    if (testId) {
      return testId;
    }
    return `formulario ${index + 1}`;
  }

  // --- Formularios y campos ------------------------------------------------

  const formElements: any[] = Array.from(doc.querySelectorAll ? doc.querySelectorAll('form') : []);
  const formLabels: Array<{ el: any; label: string }> = formElements.map((form, index) => ({
    el: form,
    label: formLabelOf(form, index)
  }));

  function formLabelOfControl(control: any): string | null {
    const form = control.closest?.('form');
    if (!form) {
      return null;
    }
    const hit = formLabels.find(entry => entry.el === form);
    return hit ? hit.label : null;
  }

  function fieldOf(control: any): DiscoveryField | null {
    const type = fieldType(control);
    if (tagOf(control) === 'input' && ['submit', 'button', 'reset', 'image', 'hidden'].includes(type)) {
      return null;
    }
    if (isHidden(control)) {
      return null;
    }
    const label = labelOf(control) || clean(control.getAttribute?.('name') || '', 60) || 'campo sin etiqueta';
    const { selector } = selectorFor(control, { name: label, role: roleOf(control, tagOf(control)) });
    return { label, type, selector };
  }

  const forms: DiscoveryForm[] = formElements.map((form, index) => {
    const controls: any[] = Array.from(form.querySelectorAll?.('input, select, textarea') ?? []);
    const fields = controls
      .map(fieldOf)
      .filter((field): field is DiscoveryField => !!field);
    return { label: formLabelOf(form, index), fields };
  });

  // --- Encabezados ---------------------------------------------------------

  const headings: DiscoveryHeading[] = Array.from(doc.querySelectorAll ? doc.querySelectorAll('h1, h2, h3, h4, h5, h6') : [])
    .filter((element: any) => !isHidden(element))
    .map((element: any) => ({
      level: Number(String(tagOf(element)).replace('h', '')) || 1,
      text: visibleText(element)
    }))
    .filter((heading: DiscoveryHeading) => heading.text.length > 0)
    .slice(0, MAX_HEADINGS);

  // --- Elementos: botones, enlaces, campos y estados -----------------------

  const elements: DiscoveryElement[] = [];
  const seen = new Set<string>();

  function pushElement(element: DiscoveryElement): void {
    if (!element.selector || seen.has(element.selector) || elements.length >= MAX_ELEMENTS) {
      return;
    }
    seen.add(element.selector);
    elements.push(element);
  }

  const buttonNodes: any[] = Array.from(
    doc.querySelectorAll
      ? doc.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]')
      : []
  ).filter((element: any) => !isHidden(element));

  for (const node of buttonNodes) {
    const tag = tagOf(node);
    const text = accessibleName(node, visibleText(node));
    const buttonSelector = selectorFor(node, { name: text, role: roleOf(node, tag), tag });
    pushElement({
      kind: 'button',
      text,
      selector: buttonSelector.selector,
      selectorStrategy: buttonSelector.strategy,
      formLabel: formLabelOfControl(node)
    });
  }

  const linkNodes: any[] = Array.from(doc.querySelectorAll ? doc.querySelectorAll('a[href]') : []).filter(
    (element: any) => !isHidden(element)
  );

  const linkTargets: string[] = [];

  for (const node of linkNodes) {
    const href = clean(node.getAttribute('href') || '', 600);
    if (!href) {
      continue;
    }
    // Las anclas se guardan tal cual: no son pantallas y el crawler las
    // descarta con motivo 'ancla' sin resolverlas contra la URL actual.
    linkTargets.push(href.startsWith('#') ? href : absolute(href));

    const tag = tagOf(node);
    const text = accessibleName(node, visibleText(node));
    const linkSelector = selectorFor(node, { name: text, role: roleOf(node, tag), tag });
    pushElement({
      kind: 'link',
      text,
      selector: linkSelector.selector,
      selectorStrategy: linkSelector.strategy,
      formLabel: formLabelOfControl(node)
    });
  }

  const controlNodes: any[] = Array.from(
    doc.querySelectorAll ? doc.querySelectorAll('input, select, textarea') : []
  ).filter((element: any) => !isHidden(element));

  for (const node of controlNodes) {
    const field = fieldOf(node);
    if (!field) {
      continue;
    }
    const tag = tagOf(node);
    pushElement({
      kind: tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'input',
      text: field.label,
      selector: field.selector,
      selectorStrategy: selectorFor(node, { name: field.label, role: roleOf(node, tag) }).strategy,
      formLabel: formLabelOfControl(node)
    });
  }

  const statusTexts: string[] = [];
  const statusNodes: any[] = Array.from(doc.querySelectorAll ? doc.querySelectorAll(STATUS_SELECTOR) : []).filter(
    (element: any) => !isHidden(element)
  );

  for (const node of statusNodes) {
    const text = clean(node.textContent, MAX_STATUS);
    if (!text) {
      continue;
    }
    if (statusTexts.indexOf(text) === -1) {
      statusTexts.push(text);
    }
    const tag = tagOf(node);
    const statusSelector = selectorFor(node, { name: text, role: roleOf(node, tag), tag });
    pushElement({
      kind: 'status',
      text,
      selector: statusSelector.selector,
      selectorStrategy: statusSelector.strategy,
      formLabel: formLabelOfControl(node)
    });
  }

  return {
    url: baseUrl,
    title: clean(doc.title, 200),
    headings,
    elements,
    forms,
    statusTexts,
    linkTargets
  };
}
