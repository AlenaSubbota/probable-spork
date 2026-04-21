import AuthForm from '@/components/auth/AuthForm';

export const metadata = {
  title: 'Регистрация — Chaptify',
};

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <AuthForm mode="register" />
    </main>
  );
}
