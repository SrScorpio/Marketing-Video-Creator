import { describe, expect, it } from 'vitest';
import {
  buildConcatArgs,
  buildConcatList,
  buildCutArgs,
  buildMuxArgs,
  buildPhaseClipArgs,
  buildProbeDurationArgs,
  buildVariantArgs,
  escapeConcatPath,
  parseProbeDuration,
  scalePadFilter,
  silentAudioInputArgs
} from '../src/utils/ffmpeg-args';

describe('scalePadFilter', () => {
  it('usa el lienzo indicado y fps por defecto 30', () => {
    expect(scalePadFilter({ width: 1080, height: 1920 })).toBe(
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p'
    );
  });

  it('respeta fps y color de fondo', () => {
    const filter = scalePadFilter({ width: 1920, height: 1080, fps: 24, background: 'white' });
    expect(filter).toContain('fps=24');
    expect(filter).toContain('color=white');
  });
});

describe('silentAudioInputArgs', () => {
  it('genera audio silencioso con la duración pedida', () => {
    expect(silentAudioInputArgs(4.5)).toEqual([
      '-f',
      'lavfi',
      '-t',
      '4.5',
      '-i',
      'anullsrc=r=48000:cl=stereo'
    ]);
  });

  it('nunca genera duración cero', () => {
    expect(silentAudioInputArgs(0)).toContain('0.1');
  });
});

describe('buildPhaseClipArgs', () => {
  it('mapea vídeo + audio y normaliza el clip', () => {
    const args = buildPhaseClipArgs({
      videoInput: '/tmp/clips/fase 1.webm',
      audioInput: '/tmp/audio/fase 1.wav',
      videoDurationSec: 5,
      output: '/tmp/clips/fase 1.mp4',
      canvas: { width: 1920, height: 1080 }
    });

    expect(args).toContain('/tmp/clips/fase 1.webm');
    expect(args).toContain('/tmp/audio/fase 1.wav');
    expect(args).toContain('/tmp/clips/fase 1.mp4');
    expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0');
    expect(args).toContain('-pix_fmt');
    expect(args[args.length - 1]).toBe('/tmp/clips/fase 1.mp4');
  });

  it('usa audio silencioso cuando no hay narración', () => {
    const args = buildPhaseClipArgs({
      videoInput: 'in.webm',
      audioInput: null,
      videoDurationSec: 3,
      output: 'out.mp4',
      canvas: { width: 1080, height: 1920 }
    });

    expect(args.join(' ')).toContain('anullsrc=r=48000:cl=stereo');
    expect(args).not.toContain('-af');
  });

  it('clona el último fotograma si la narración es más larga', () => {
    const args = buildPhaseClipArgs({
      videoInput: 'in.webm',
      audioInput: 'narration.wav',
      videoDurationSec: 4,
      output: 'out.mp4',
      canvas: { width: 1920, height: 1080 },
      padVideoBySec: 2
    });

    expect(args.join(' ')).toContain('tpad=stop_mode=clone:stop_duration=2');
    expect(args.slice(0, 2)).toEqual(['-t', '6']);
  });

  it('añade silencio si el vídeo es más largo que el audio', () => {
    const args = buildPhaseClipArgs({
      videoInput: 'in.webm',
      audioInput: 'narration.wav',
      videoDurationSec: 6,
      output: 'out.mp4',
      canvas: { width: 1920, height: 1080 },
      padAudioBySec: 2
    });

    expect(args.join(' ')).toContain('apad=whole_dur=8');
  });
});

describe('buildCutArgs', () => {
  it('rechaza rangos inválidos', () => {
    expect(() => buildCutArgs('in.mp4', 'out.mp4', 5, 5)).toThrow(/Rango de corte inválido/);
    expect(() => buildCutArgs('in.mp4', 'out.mp4', 6, 2)).toThrow(/Rango de corte inválido/);
  });

  it('corta sin audio', () => {
    const args = buildCutArgs('in.mp4', 'out.mp4', 1, 3);
    expect(args).toContain('-ss');
    expect(args).toContain('-an');
    expect(args).toContain('out.mp4');
  });
});

describe('buildMuxArgs', () => {
  it('copia el vídeo y recodifica el audio', () => {
    const args = buildMuxArgs('v.mp4', 'a.wav', 'out.mp4');
    expect(args.join(' ')).toContain('-c:v copy');
    expect(args.join(' ')).toContain('-c:a aac');
  });
});

describe('concat', () => {
  it('escapa comillas simples en las rutas', () => {
    expect(escapeConcatPath("/tmp/a'b.mp4")).toBe("/tmp/a'\\''b.mp4");
  });

  it('genera la lista con una entrada por fichero', () => {
    const list = buildConcatList(['/tmp/uno.mp4', '/tmp/dos.mp4']);
    expect(list).toBe("file '/tmp/uno.mp4'\nfile '/tmp/dos.mp4'\n");
  });

  it('usa el demuxer concat sin recodificar', () => {
    const args = buildConcatArgs('/tmp/list.txt', '/tmp/final.mp4');
    expect(args.slice(0, 5)).toEqual(['-f', 'concat', '-safe', '0', '-i']);
    expect(args.join(' ')).toContain('-c copy');
  });
});

describe('buildVariantArgs', () => {
  it('escala al lienzo del lienzo indicado', () => {
    const args = buildVariantArgs('master.mp4', 'mobile.mp4', { width: 1080, height: 1920 });
    expect(args.join(' ')).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
  });
});

describe('probe', () => {
  it('construye la consulta de duración', () => {
    expect(buildProbeDurationArgs('in.mp4')).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      'in.mp4'
    ]);
  });

  it('interpreta la salida numérica', () => {
    expect(parseProbeDuration('12.345\n')).toBe(12.345);
    expect(parseProbeDuration('N/A')).toBeNull();
    expect(parseProbeDuration('0')).toBeNull();
    expect(parseProbeDuration('')).toBeNull();
  });
});
