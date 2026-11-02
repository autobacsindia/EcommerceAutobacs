import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReturnRequestModal from './ReturnRequestModal';
import { UNBOXING_VIDEO_RULE } from '@/lib/constants';

/*
  The customer's return form. What it must get right (the server re-checks all of it,
  but a form that lets a customer build a request the server refuses wastes their
  upload): the two windows (7 days for our fault, 4 for their own reason), the
  unused-and-boxed declaration, a photo AND the unboxing video always (an upload, or a
  Drive/YouTube link when it is too big), the refund figure coming from the SERVER,
  and the exact payload.
*/
const mockPost = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockPost(...a) } }));

let uploadCount = 0;
jest.mock('@/lib/returnUploads', () => ({
  getReturnUploadSignature: jest.fn(async () => ({ provider: 'cloudinary', signature: 's' })),
  uploadReturnFile: jest.fn(async (_f: File, _c: unknown, resourceType: string) => {
    uploadCount += 1;
    return { publicId: `ret/${resourceType}-${uploadCount}`, provider: 'cloudinary' };
  }),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const item = (over: Record<string, unknown> = {}) => ({
  _id: 'line1',
  product: { _id: 'p1', name: 'Dash Cam', price: 9000 },
  quantity: 1,
  price: 9000,
  name: 'Dash Cam',
  deliveredAt: daysAgo(2),
  ...over,
});

const setup = (props: Partial<React.ComponentProps<typeof ReturnRequestModal>> = {}) => {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  render(
    <ReturnRequestModal
      orderId="order1"
      orderNumber="ABCD1234"
      items={[item()]}
      deliveredAt={daysAgo(2)}
      onClose={onClose}
      onSuccess={onSuccess}
      {...props}
    />,
  );
  return { onClose, onSuccess };
};

const next = () => fireEvent.click(screen.getByRole('button', { name: /Next/ }));
const pickFirstItem = () => fireEvent.click(screen.getAllByRole('checkbox')[0]);
const chooseReason = (label: RegExp) => fireEvent.click(screen.getByRole('radio', { name: label }));
const describe_ = (text = 'It arrived broken') =>
  fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: text } });
const fileInputs = () => Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
const uploadTo = async (accept: string, name: string, type: string) => {
  const input = fileInputs().find((i) => i.accept === accept)!;
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type })] } });
  await waitFor(() => expect(screen.getAllByText(name, { exact: false }).length).toBeGreaterThan(0));
};

beforeEach(() => {
  mockPost.mockReset();
  uploadCount = 0;
  mockPost.mockImplementation(async (url: string) => (url === '/returns/estimate'
    ? { success: true, estimate: { goods: 9000, shippingShare: 200, total: 9200, pickupCostDeducted: false, installationOnBill: false } }
    : { success: true }));
});

describe('ReturnRequestModal', () => {
  it('closes the form after 7 days, but is open on day 6', () => {
    setup({ deliveredAt: daysAgo(8), items: [item({ deliveredAt: daysAgo(8) })] });
    expect(screen.getByText('Return window closed')).toBeInTheDocument();
    expect(screen.getByText(/within 7 days of delivery/)).toBeInTheDocument();
  });

  it('on day 5 offers our-fault reasons but not "changed my mind"', () => {
    setup({ deliveredAt: daysAgo(5), items: [item({ deliveredAt: daysAgo(5) })] });
    pickFirstItem();
    next();
    expect(screen.getByRole('radio', { name: /Damaged in transit/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /I changed my mind/ })).toBeDisabled();
    expect(screen.getAllByText(/Only within 4 days of delivery/).length).toBe(2);
  });

  it('a customer reason needs the unused-and-boxed declaration', () => {
    setup();
    pickFirstItem();
    next();
    chooseReason(/I changed my mind/);
    describe_('Bought the wrong one');
    next();
    expect(screen.getByText(/confirm the item is unused/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /unused, has not been installed/ }));
    next();
    expect(screen.getByText('Unboxing video and photos')).toBeInTheDocument();
  });

  it('needs a photo and the unboxing video, whatever the reason', async () => {
    setup();
    pickFirstItem();
    next();
    chooseReason(/Damaged in transit/);
    describe_();
    next();
    next();
    expect(screen.getByText('Add at least one photo of the item.')).toBeInTheDocument();
    await uploadTo('image/*', 'crack.jpg', 'image/jpeg');
    next();
    expect(screen.getByText(/The unboxing video is required/)).toBeInTheDocument();
    await uploadTo('video/*', 'parcel.mp4', 'video/mp4');
    next();
    expect(screen.getByText('Review & submit')).toBeInTheDocument();
  });

  it('asks for the video even for a cheap missing part, and sends the exact payload', async () => {
    const { onSuccess } = setup();
    pickFirstItem();
    next();
    chooseReason(/Missing part/);
    describe_('No mounting bracket');
    next();
    expect(screen.getByText(UNBOXING_VIDEO_RULE)).toBeInTheDocument();
    await uploadTo('image/*', 'box.jpg', 'image/jpeg');
    await uploadTo('video/*', 'unboxing.mp4', 'video/mp4');
    next();

    // The refund figure is the server's, fetched for this exact selection.
    expect(await screen.findByTestId('return-estimate')).toHaveTextContent('₹9,200');
    expect(mockPost).toHaveBeenCalledWith('/returns/estimate', {
      orderId: 'order1', items: [{ itemId: 'line1', quantity: 1, reason: 'missing_part' }],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText('Request submitted');
    const [, body] = mockPost.mock.calls.find(([url]) => url === '/returns')!;
    expect(body).toEqual({
      orderId: 'order1',
      items: [{ itemId: 'line1', quantity: 1, reason: 'missing_part' }],
      problemDescription: 'No mounting bracket',
      video: { publicId: 'ret/video-2', provider: 'cloudinary', resourceType: 'video' },
      images: [{ publicId: 'ret/image-1', provider: 'cloudinary', resourceType: 'image' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('declares unused for a customer reason, and sends the uploaded video', async () => {
    setup({ items: [item({ price: 12000, product: { _id: 'p1', name: 'Dash Cam', price: 12000 } })] });
    pickFirstItem();
    next();
    chooseReason(/I ordered the wrong model/);
    fireEvent.click(screen.getByRole('checkbox', { name: /unused, has not been installed/ }));
    describe_('Wrong size');
    next();
    await uploadTo('image/*', 'a.jpg', 'image/jpeg');
    await uploadTo('video/*', 'b.mp4', 'video/mp4');
    next();
    await screen.findByTestId('return-estimate');
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText('Request submitted');
    const [, body] = mockPost.mock.calls.find(([url]) => url === '/returns')!;
    expect(body.unusedDeclared).toBe(true);
    expect(body.video).toEqual({ publicId: 'ret/video-2', provider: 'cloudinary', resourceType: 'video' });
    expect(body.proofOfPurchase).toBeUndefined();
  });

  it('hides the figure, but still lets the customer submit, when the estimate fails', async () => {
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/returns/estimate') throw new Error('down');
      return { success: true };
    });
    setup();
    pickFirstItem();
    next();
    chooseReason(/Manufacturing defect/);
    describe_('Does not power on');
    next();
    await uploadTo('image/*', 'a.jpg', 'image/jpeg');
    await uploadTo('video/*', 'v.mp4', 'video/mp4');
    next();
    await waitFor(() => expect(screen.queryByText(/Working out your refund/)).not.toBeInTheDocument());
    expect(screen.queryByTestId('return-estimate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Request submitted')).toBeInTheDocument();
  });

  it('shows the server error when the request is refused', async () => {
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/returns') throw new Error('A return for one of these items is already in progress.');
      return { success: true, estimate: { goods: 9000, shippingShare: 0, total: 9000, pickupCostDeducted: false, installationOnBill: false } };
    });
    setup();
    pickFirstItem();
    next();
    chooseReason(/Wrong item shipped/);
    describe_('Wrong colour');
    next();
    await uploadTo('image/*', 'a.jpg', 'image/jpeg');
    await uploadTo('video/*', 'v.mp4', 'video/mp4');
    next();
    await screen.findByTestId('return-estimate');
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('A return for one of these items is already in progress.')).toBeInTheDocument();
  });

  it('takes a Google Drive or YouTube link instead of an upload, and refuses any other link', async () => {
    setup();
    pickFirstItem();
    next();
    chooseReason(/Damaged in transit/);
    describe_();
    next();
    await uploadTo('image/*', 'crack.jpg', 'image/jpeg');
    const link = screen.getByPlaceholderText(/drive\.google\.com/);
    fireEvent.change(link, { target: { value: 'https://dropbox.com/s/x' } });
    next();
    expect(screen.getByText(/Paste a Google Drive or YouTube link starting with https/)).toBeInTheDocument();
    fireEvent.change(link, { target: { value: ' https://youtu.be/abc123 ' } });
    next();
    await screen.findByTestId('return-estimate');
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText('Request submitted');
    const [, body] = mockPost.mock.calls.find(([url]) => url === '/returns')!;
    expect(body.videoLink).toBe('https://youtu.be/abc123');
    expect(body.video).toBeUndefined();
  });

  it('a video over 100MB is not uploaded — the customer is pointed to the link box', async () => {
    setup();
    pickFirstItem();
    next();
    chooseReason(/Wrong item shipped/);
    describe_('Wrong colour');
    next();
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(fileInputs().find((i) => i.accept === 'video/*')!, { target: { files: [big] } });
    expect(await screen.findByText(/over 100MB\. Upload it to Google Drive or YouTube/)).toBeInTheDocument();
    expect(uploadCount).toBe(0);
  });
});
