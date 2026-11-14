import { describe, expect, it } from 'vitest';
import { WINDOWS_ZIP, pickWindowsAsset, windowsZipCandidates } from '../src/index.ts';

const asset = (name: string, tag = 'v1') => ({ name, browser_download_url: `https://github.com/ggml-org/whisper.cpp/releases/download/${tag}/${name}` });
const DIRECT = `https://github.com/ggml-org/whisper.cpp/releases/latest/download/${WINDOWS_ZIP}`;

describe('whisper.cpp download for Windows', () => {
  it('picks the 64-bit CPU build, never Win32, BLAS or CUDA', () => {
    const assets = [asset('whisper-bin-Win32.zip'), asset('whisper-blas-bin-x64.zip'), asset('whisper-cublas-12.4.0-bin-x64.zip'), asset('whisper-bin-x64.zip'), asset('whisper-bin-ubuntu-x64.tar.gz')];
    expect(pickWindowsAsset(assets)?.name).toBe('whisper-bin-x64.zip');
    expect(pickWindowsAsset([asset('whisper-blas-bin-x64.zip')])).toBeUndefined();
    expect(pickWindowsAsset(undefined)).toBeUndefined();
  });
  it('uses the latest release when it has the file, with the direct link as a fallback', () => {
    const urls = windowsZipCandidates({ assets: [asset('whisper-bin-x64.zip', 'v9')] }, null);
    expect(urls).toEqual([asset('whisper-bin-x64.zip', 'v9').browser_download_url, DIRECT]);
  });
  it('falls back to an older release when the latest has no Windows file yet', () => {
    const urls = windowsZipCandidates({ assets: [] }, [{ assets: [] }, { assets: [asset('whisper-bin-x64.zip', 'v8')] }]);
    expect(urls).toEqual([asset('whisper-bin-x64.zip', 'v8').browser_download_url, DIRECT]);
  });
  it('still has the direct link when GitHub API did not answer (rate limit, no network)', () => {
    expect(windowsZipCandidates(null, null)).toEqual([DIRECT]);
    expect(windowsZipCandidates({ message: 'API rate limit exceeded' } as never, { message: 'x' } as never)).toEqual([DIRECT]);
  });
});
