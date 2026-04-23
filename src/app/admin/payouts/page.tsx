import { redirect } from 'next/navigation';

// /admin/payouts — устарел после мигр. 045 (per-translator кошельки).
// Настройки способов оплаты живут в /profile/settings → блок
// «Способы оплаты» (PaymentMethodsEditor). Chaptify деньги не проводит,
// отдельного дашборда «выплат» больше нет.
export default function PayoutsRedirect() {
  redirect('/profile/settings');
}
