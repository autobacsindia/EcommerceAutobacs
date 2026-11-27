/**
 * A failed job application is reported to the "Website errors" page with the STEP
 * that failed (and, for an upload, which file slot and the HTTP status) — never the
 * applicant's name, email or file name. Reporting is the only thing these tests
 * add; the applicant still sees the same error message.
 */
import { render, fireEvent, waitFor } from '@testing-library/react';
import CareersApplication, { type CareerPosting } from './CareersApplication';

const post = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));
const report = jest.fn();
jest.mock('@/lib/reportClientError', () => ({
  reportClientError: (r: unknown) => report(r),
  httpStatusOf: (e: { status?: number }) => (typeof e?.status === 'number' ? e.status : undefined),
}));

const posting: CareerPosting = {
  _id: 'id1', department: 'Marketing', title: 'Marketing Manager', slug: 'marketing-manager',
  tagline: 't', experience: 'e', intro: 'i', responsibilities: ['r'], requirements: ['q'], closer: 'c',
};

function setFile(container: HTMLElement, id: string, file: File) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function fillAndSubmit(container: HTMLElement) {
  const role = container.querySelector<HTMLSelectElement>('#rv-role-select')!;
  role.value = role.options[1].value;
  fireEvent.change(role);
  fireEvent.click(container.querySelector('.rv-source-btn[data-value="LinkedIn"]')!);
  const set = (name: string, value: string) => {
    const el = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    el.value = value;
  };
  set('fullName', 'Ravi Kumar');
  set('city', 'Kochi');
  set('email', 'ravi@example.com');
  set('whatYouBring', 'Things');
  setFile(container, 'q1-file', new File(['a'], 'Ravi answer one.mp4', { type: 'video/mp4' }));
  setFile(container, 'q2-file', new File(['b'], 'Ravi answer two.mp4', { type: 'video/mp4' }));
  setFile(container, 'resume-file', new File(['c'], 'Ravi CV.pdf', { type: 'application/pdf' }));
  fireEvent.submit(container.querySelector('#rv-appForm')!);
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); window.scrollTo = jest.fn() as unknown as typeof window.scrollTo; });
beforeEach(() => { post.mockReset(); report.mockReset(); });

it('upload-signature failure is reported with its step and HTTP status', async () => {
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('upload-signature')) throw Object.assign(new Error('Service unavailable'), { status: 503 });
    return {};
  });
  const { container } = render(<CareersApplication postings={[posting]} />);
  fillAndSubmit(container);
  await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  const [r] = report.mock.calls[0];
  expect(r).toMatchObject({ feature: 'careers', step: 'upload-signature', context: expect.objectContaining({ httpStatus: 503 }) });
  expect(JSON.stringify(r.context)).not.toMatch(/Ravi|example\.com/);
  // The applicant still sees the error.
  expect(container.querySelector('#rv-errMsg')!.textContent).toBe('Service unavailable');
});

it('a failed file upload is reported with the slot, provider and status, not the file name', async () => {
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('upload-signature')) {
      return {
        success: true, provider: 'r2', folder: 'f',
        uploads: ['videoOne', 'videoTwo', 'resume'].map((slot) => ({ slot, uploadUrl: `https://r2.test/${slot}`, key: `k/${slot}`, contentType: 'video/mp4' })),
      };
    }
    return {};
  });
  // Every PUT answers 403 except the resume.
  class FakeXHR {
    status = 0; upload = { onprogress: null }; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    url = '';
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader() {}
    send() { this.status = this.url.endsWith('videoOne') ? 403 : 200; setTimeout(() => this.onload?.(), 0); }
  }
  const orig = global.XMLHttpRequest;
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  try {
    const { container } = render(<CareersApplication postings={[posting]} />);
    fillAndSubmit(container);
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    const [r] = report.mock.calls[0];
    expect(r).toMatchObject({
      feature: 'careers', step: 'file-upload',
      context: expect.objectContaining({ slot: 'videoOne', provider: 'r2', httpStatus: 403, mime: 'video/mp4', failedUploads: 1 }),
    });
    expect(JSON.stringify(r)).not.toMatch(/Ravi|answer one|CV\.pdf/);
    // The uploads that DID land are still handed back for cleanup.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/careers/applications/cleanup', expect.anything()));
  } finally {
    global.XMLHttpRequest = orig;
  }
});
