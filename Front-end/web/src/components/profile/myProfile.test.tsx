import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { submitMultipart } from '@/lib/multipartResponse';
import StaffProfileForm, { type MyProfile } from './StaffProfileForm';
import PhotoEditor from './PhotoEditor';
import PersonFace, { initialsOf } from './PersonFace';
import { centredView, clampView, photoProblem, sourceRect, zoomTo, MAX_PICK_BYTES } from './photoCrop';
import PanelShell from '@/components/panel/PanelShell';
import { Avatar } from '@/components/tasks/ui';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('@/lib/multipartResponse', () => ({ submitMultipart: jest.fn(), parseApiResponse: jest.fn() }));
const refreshUser = jest.fn().mockResolvedValue(undefined);
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { username: null }, refreshUser }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('next/navigation', () => ({ usePathname: () => '/team' }));
jest.mock('@/components/notifications/PushPrompt', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/panel/PanelThemeSwitch', () => ({ __esModule: true, default: () => null }));

const get = apiClient.get as jest.Mock;
const put = apiClient.put as jest.Mock;

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const ME: MyProfile = {
  name: 'Nevin P Vinu', email: 'nevin@example.com', phone: '9876543210', role: 'staff', teamLabel: 'GTM',
  avatar: { url: '' },
  profile: { jobTitle: '', dateOfBirth: '', emergencyContact: { name: '', phone: '' }, bio: '' },
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => (url === '/profile' ? Promise.resolve({ me: ME }) : Promise.resolve({ photos: {} })));
});

describe('photo crop maths', () => {
  it('accepts JPG/PNG/WebP and refuses anything else or a huge file', () => {
    expect(photoProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(photoProblem({ type: 'application/pdf', size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(photoProblem({ type: 'image/gif', size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(photoProblem({ type: 'image/png', size: MAX_PICK_BYTES + 1 })).toMatch(/too big/);
  });

  it('starts centred on the middle square of a landscape photo', () => {
    const v = centredView(1000, 500, 200);
    expect(sourceRect(1000, 500, 200, v)).toEqual({ sx: 250, sy: 0, side: 500 });
  });

  it('never lets the picture leave a gap in the square', () => {
    const v = clampView(1000, 500, 200, { zoom: 1, x: 50, y: -999 });
    expect(v).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampView(1000, 500, 200, { zoom: 9, x: 0, y: 0 }).zoom).toBe(3);
  });

  it('zooming keeps the middle of the picture in the middle', () => {
    const v = zoomTo(1000, 1000, 200, centredView(1000, 1000, 200), 2);
    const r = sourceRect(1000, 1000, 200, v);
    expect(r.side).toBe(500);
    expect(r.sx + r.side / 2).toBeCloseTo(500);
    expect(r.sy + r.side / 2).toBeCloseTo(500);
  });
});

describe('PersonFace', () => {
  it('shows initials without a photo, and the photo when there is one', () => {
    const { container, rerender } = render(<PersonFace name="Nevin P Vinu" />);
    expect(container).toHaveTextContent('NP');
    rerender(<PersonFace name="Nevin P Vinu" photoUrl="https://img.example.com/n.jpg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img.example.com/n.jpg');
  });

  it('falls back to initials when the photo fails to load', () => {
    const { container } = render(<PersonFace name="Asha" photoUrl="https://img.example.com/broken.jpg" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('A');
  });

  it('initials ignore extra spaces and email-style names', () => {
    expect(initialsOf('  abishek   s ')).toBe('AS');
    expect(initialsOf('ravi.k@example.com')).toBe('RK');
    expect(initialsOf('')).toBe('·');
  });
});

describe('PhotoEditor', () => {
  it('refuses a non-image file before anything is uploaded', () => {
    render(<PhotoEditor name="Asha" photoUrl="" onChanged={jest.fn()} />);
    const input = screen.getByLabelText('Choose a profile photo');
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/JPG, PNG or WebP/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submitMultipart).not.toHaveBeenCalled();
  });

  it('removes the photo through the API and reports it', async () => {
    const onChanged = jest.fn();
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    render(<PhotoEditor name="Asha" photoUrl="https://img.example.com/a.jpg" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(''));
    expect(apiClient.delete).toHaveBeenCalledWith('/profile/avatar');
  });
});

describe('StaffProfileForm', () => {
  it('shows email and team read-only', async () => {
    wrap(<StaffProfileForm passwordHref="/team/password" />);
    expect(await screen.findByDisplayValue('Nevin P Vinu')).toBeInTheDocument();
    expect(screen.getByText('nevin@example.com')).toBeInTheDocument();
    expect(screen.getByText(/GTM/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('nevin@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /change password/i })).toHaveAttribute('href', '/team/password');
  });

  it('saves only the allowed fields — never email, role or team', async () => {
    put.mockImplementation((_url: string, body: { name: string }) =>
      Promise.resolve({ user: { ...ME, name: body.name, profile: { ...ME.profile, jobTitle: 'Sales Executive' } } }));
    wrap(<StaffProfileForm />);
    fireEvent.change(await screen.findByPlaceholderText('Sales Executive'), { target: { value: 'Sales Executive' } });
    fireEvent.change(screen.getByPlaceholderText('Ravi (brother)'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByPlaceholderText('98400 12345'), { target: { value: '98400 12345' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/profile');
    expect(Object.keys(body).sort()).toEqual(['name', 'phone', 'profile']);
    expect(body.profile).toEqual({
      jobTitle: 'Sales Executive', dateOfBirth: '', emergencyContact: { name: 'Ravi', phone: '98400 12345' }, bio: '',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(refreshUser).toHaveBeenCalled();
  });

  it("shows the server's reason when a save is refused", async () => {
    put.mockRejectedValue({ rawData: { message: 'Emergency contact needs both a name and a phone number.' } });
    wrap(<StaffProfileForm />);
    fireEvent.change(await screen.findByPlaceholderText('Ravi (brother)'), { target: { value: 'Ravi' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('both a name and a phone');
  });
});

describe('faces in the panel', () => {
  it('the sidebar shows my photo and links to My profile', () => {
    render(
      <PanelShell homeHref="/team" subtitle="" sections={[]} heading="" onLogout={jest.fn()}
        user={{ name: 'Nevin P Vinu', role: 'GTM', photoUrl: 'https://img.example.com/n.jpg', profileHref: '/team/profile' }}>
        <p>page</p>
      </PanelShell>,
    );
    const link = screen.getByRole('link', { name: /my profile/i });
    expect(link).toHaveAttribute('href', '/team/profile');
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://img.example.com/n.jpg');
  });

  it("a task assignee's face uses their photo from /staff/photos, else initials", async () => {
    get.mockImplementation(() => Promise.resolve({ photos: { u1: 'https://img.example.com/u1.jpg' } }));
    const { container } = wrap(<><Avatar name="Asha K" id="u1" /><Avatar name="Bala R" id="u2" /></>);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://img.example.com/u1.jpg'));
    expect(screen.getByTitle('Bala R')).toHaveTextContent('BR');
    expect(get).toHaveBeenCalledWith('/staff/photos');
  });
});
