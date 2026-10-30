import { sendTransactionalEmail } from "./smtp.service";

export async function sendCancellationCode(to: string, code: string): Promise<void> {
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirme o cancelamento</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">

        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center" style="padding: 40px 0;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">

                <tr>
                  <td bgcolor="#003366" align="center" style="padding: 30px 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: 1px;">
                      del<span style="color: #FC8200;">Bicos</span>
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333333; margin-top: 0; font-size: 22px;">Confirme o cancelamento</h2>

                    <p style="color: #666666; font-size: 16px; line-height: 1.5;">
                      Recebemos uma solicitação para cancelar seu agendamento no <strong>DelBicos</strong>.
                    </p>

                    <p style="color: #666666; font-size: 16px; line-height: 1.5;">
                      Para confirmar o cancelamento, informe o código abaixo no aplicativo ou no chat:
                    </p>

                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 30px 0;">
                      <tr>
                        <td align="center">
                          <div style="background-color: #FFF5EB; border: 2px dashed #FC8200; border-radius: 8px; padding: 15px 30px; display: inline-block;">
                            <span style="font-size: 32px; font-weight: bold; color: #FC8200; letter-spacing: 8px; font-family: monospace;">
                              ${code}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #999999; font-size: 14px; text-align: center;">
                      ⚠️ Este código expira em <strong>10 minutos</strong>.
                    </p>

                    <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 30px 0;">

                    <p style="color: #666666; font-size: 14px; line-height: 1.5;">
                      Se você não solicitou o cancelamento, ignore este e-mail. O agendamento permanece ativo até a confirmação.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td bgcolor="#f8f9fa" style="padding: 20px 30px; text-align: center;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} DelBicos - Delivery de Serviços.<br>
                      Todos os direitos reservados.
                    </p>
                  </td>
                </tr>

              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding-top: 20px;">
                    <p style="color: #bbbbbb; font-size: 12px;">
                      Enviado automaticamente pelo sistema DelBicos.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  await sendTransactionalEmail({
    to, subject: "Confirme o cancelamento — DelBicos",
    text: `Seu código para confirmar o cancelamento é ${code}. Ele expira em 10 minutos. Se você não solicitou, ignore este e-mail. O agendamento permanece ativo até a confirmação.`,
    html,
  });
}
