import { describe, expect, it } from 'vitest';
import {
  buildSrtFromScript,
  formatSrtTime,
  parseSrt,
  parseSrtTime,
  renderSrt,
  splitScriptIntoCues
} from '../src/utils/srt';

describe('formatSrtTime', () => {
  it('formatea milisegundos en HH:MM:SS,mmm', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(1234)).toBe('00:00:01,234');
    expect(formatSrtTime(3723456)).toBe('01:02:03,456');
  });

  it('no genera tiempos negativos', () => {
    expect(formatSrtTime(-50)).toBe('00:00:00,000');
  });
});

describe('parseSrtTime', () => {
  it('convierte a milisegundos', () => {
    expect(parseSrtTime('00:00:01,234')).toBe(1234);
    expect(parseSrtTime('01:02:03,456')).toBe(3723456);
  });

  it('devuelve null con formatos inválidos', () => {
    expect(parseSrtTime('00:00:01.234')).toBeNull();
    expect(parseSrtTime('1:2:3')).toBeNull();
    expect(parseSrtTime('')).toBeNull();
  });
});

describe('parseSrt / renderSrt', () => {
  const srt = [
    '1',
    '00:00:00,000 --> 00:00:02,000',
    'Primera frase.',
    '',
    '2',
    '00:00:02,000 --> 00:00:04,500',
    'Segunda frase',
    'con dos líneas.',
    ''
  ].join('\n');

  it('parsea bloques válidos', () => {
    const entries = parseSrt(srt);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      index: 1,
      startTime: '00:00:00,000',
      endTime: '00:00:02,000',
      text: 'Primera frase.'
    });
    expect(entries[1].text).toBe('Segunda frase\ncon dos líneas.');
  });

  it('ignora bloques malformados', () => {
    const broken = '1\nno-es-un-tiempo\nHola\n\n2\n00:00:01,000 --> 00:00:02,000\nBien\n';
    const entries = parseSrt(broken);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Bien');
  });

  it('reindexa al renderizar (round-trip)', () => {
    const entries = parseSrt(srt).map((entry, index) => ({ ...entry, index: index + 10 }));
    const rendered = renderSrt(entries);
    expect(rendered.startsWith('1\n00:00:00,000 --> 00:00:02,000')).toBe(true);
    expect(parseSrt(rendered)).toHaveLength(2);
  });

  it('renderiza vacío sin entradas', () => {
    expect(renderSrt([])).toBe('');
  });
});

describe('splitScriptIntoCues', () => {
  it('agrupa frases cortas y separa las largas', () => {
    const cues = splitScriptIntoCues('Hola. ¿Qué tal? Esta frase es mucho más larga que las anteriores y supera el límite de caracteres.', 40);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0]).toBe('Hola. ¿Qué tal?');
  });

  it('devuelve lista vacía con guion vacío', () => {
    expect(splitScriptIntoCues('   ')).toEqual([]);
  });
});

describe('buildSrtFromScript', () => {
  it('genera entradas dentro de la duración indicada', () => {
    const guion =
      'Esta es la primera frase del guion de la demostración. ' +
      'Aquí va la segunda frase, que también es bastante larga para separarse. ' +
      'Y terminamos con la tercera frase del vídeo.';
    const entries = buildSrtFromScript(guion, 9000);

    expect(entries).toHaveLength(3);
    expect(entries[0].startTime).toBe('00:00:00,000');

    for (const entry of entries) {
      expect(parseSrtTime(entry.startTime)).not.toBeNull();
      expect(parseSrtTime(entry.endTime)!).toBeGreaterThan(parseSrtTime(entry.startTime)!);
    }

    expect(parseSrtTime(entries[entries.length - 1].endTime)).toBe(9000);
  });

  it('devuelve vacío si no hay guion o duración', () => {
    expect(buildSrtFromScript('', 5000)).toEqual([]);
    expect(buildSrtFromScript('Hola.', 0)).toEqual([]);
  });
});
