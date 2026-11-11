import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FestivalOfferSettingPanel from './FestivalOfferSettingPanel';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { patch: jest.fn(), put: jest.fn(), get: jest.fn() } }));
jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));

const api = apiClient as unknown as { patch: jest.Mock; put: jest.Mock; get: jest.Mock };
const TIERS = [
  { minPaise: 0, percent: 10 },
  { minPaise: 50_000_00, percent: 5 },
  { minPaise: 1_00_000_00 + 1, percent: 3 },
  { minPaise: 2_00_000_00 + 1, percent: 2 },
];
const MODELS = [
  { _id: 'red', label: 'Red', price: 3060 },
  { _id: 'black', label: 'Black', price: 4200 },
  { _id: 'kit', label: 'Kit', price: 6390 },
];
const rowOf = (label: string) => screen.getByText(label, { selector: 'div' }).closest('li') as HTMLElement;

beforeEach(() => {
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'admin' } });
  api.patch.mockReset();
  api.put.mockReset().mockImplementation((_url: string, body: { mode: string; variants: { variantId: string; mode: string; percent?: number }[] }) => Promise.resolve({
    success: true, updated: true,
    festivalOfferSetting: body.mode === 'auto' ? null : { mode: body.mode },
    festivalOfferVariantSettings: body.variants.filter((v) => v.mode !== 'inherit'),
  }));
  api.get.mockReset().mockResolvedValue({ offer: { tiers: TIERS, live: true } });
});

describe('FestivalOfferSettingPanel — per model', () => {
  it('lists each model with its price and the price the customer pays', async () => {
    render(<FestivalOfferSettingPanel productId="p1" setting={null} models={MODELS} />);
    expect(await within(rowOf('Red')).findByText('₹2,754')).toBeInTheDocument();
    expect(within(rowOf('Kit')).getByText('₹6,390')).toBeInTheDocument();
    expect(within(rowOf('Kit')).getByText('₹5,751')).toBeInTheDocument();
  });

  it('the preview follows each choice (No offer, Custom, Same as product)', async () => {
    render(<FestivalOfferSettingPanel productId="p1" setting={null} models={MODELS} />);
    await within(rowOf('Red')).findByText('₹2,754');
    fireEvent.change(screen.getByLabelText('Diwali offer for Black'), { target: { value: 'none' } });
    expect(within(rowOf('Black')).getByText(/normal price/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Diwali offer for Kit'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom percentage for Kit'), { target: { value: '15' } });
    expect(within(rowOf('Kit')).getByText('₹5,431')).toBeInTheDocument();
    // Product → No offer: Red (same as product) follows, Kit keeps its own 15%.
    fireEvent.click(screen.getByRole('radio', { name: /No Diwali offer/ }));
    expect(within(rowOf('Red')).getByText(/normal price/)).toBeInTheDocument();
    expect(within(rowOf('Kit')).getByText('₹5,431')).toBeInTheDocument();
  });

  it('saves the product and every model in ONE request', async () => {
    render(<FestivalOfferSettingPanel productId="p1" setting={null} models={MODELS} />);
    fireEvent.change(screen.getByLabelText('Diwali offer for Black'), { target: { value: 'none' } });
    fireEvent.change(screen.getByLabelText('Diwali offer for Kit'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom percentage for Kit'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Diwali offer' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/products/p1/festival-offer', {
      mode: 'auto',
      variants: [
        { variantId: 'red', mode: 'inherit' },
        { variantId: 'black', mode: 'none' },
        { variantId: 'kit', mode: 'custom', percent: 15 },
      ],
    }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 models with their own offer/)).toBeInTheDocument();
  });

  it('loads saved model choices and blocks a bad model % before calling the server', async () => {
    render(
      <FestivalOfferSettingPanel
        productId="p1"
        setting={null}
        models={MODELS}
        variantSettings={[{ variantId: 'kit', mode: 'custom', percent: 12 }]}
      />,
    );
    expect(screen.getByLabelText('Diwali offer for Kit')).toHaveValue('custom');
    expect(screen.getByLabelText('Custom percentage for Kit')).toHaveValue('12');
    fireEvent.change(screen.getByLabelText('Custom percentage for Kit'), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Diwali offer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Kit: Enter a whole number from 1 to 30');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('says when the Diwali switch is off, and that new models need a product save first', async () => {
    api.get.mockResolvedValue({ offer: { tiers: TIERS, live: false } });
    render(<FestivalOfferSettingPanel productId="p1" setting={null} models={MODELS} hasUnsavedModels />);
    expect(await screen.findByText(/switched off right now/)).toBeInTheDocument();
    expect(screen.getByText(/New models appear here after you click Update/)).toBeInTheDocument();
  });

  it('shows each model read-only to staff outside marketing', () => {
    (useAuth as jest.Mock).mockReturnValue({ user: { role: 'staff', staff: { team: 'sales' } } });
    render(<FestivalOfferSettingPanel productId="p1" setting={{ mode: 'none' }} models={MODELS} variantSettings={[{ variantId: 'kit', mode: 'auto' }]} />);
    expect(screen.getByText('Kit: Automatic')).toBeInTheDocument();
    expect(screen.getByText('Red: Same as product (No offer)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});
