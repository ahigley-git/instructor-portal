# Builds public/forms/resq-direct-deposit-authorization.pdf, a blank fillable form.
# Run: python3 scripts/make-dd-form.py
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import simpleSplit

INK, EMBER, SLATE, LINE = HexColor('#1C1C1C'), HexColor('#B73B35'), HexColor('#5B6573'), HexColor('#D9DDE3')
OUT = 'public/forms/resq-direct-deposit-authorization.pdf'
W, H = letter
M = 54
c = canvas.Canvas(OUT, pagesize=letter)
c.setTitle('ResQ Education Direct Deposit Authorization')
c.setAuthor('ResQ Education LLC')
f = c.acroForm

# header band
c.setFillColor(INK); c.rect(0, H - 96, W, 96, fill=1, stroke=0)
c.setFillColor(HexColor('#9AA3AF')); c.setFont('Courier-Bold', 9); c.drawString(M, H - 38, 'RESQ EDUCATION')
c.setFillColor(white); c.setFont('Helvetica-Bold', 22); c.drawString(M, H - 66, 'Direct Deposit ')
c.setFillColor(HexColor('#E5756F')); c.drawString(M + c.stringWidth('Direct Deposit ', 'Helvetica-Bold', 22), H - 66, 'Authorization')
c.setFillColor(HexColor('#C9CED6')); c.setFont('Helvetica', 9); c.drawRightString(W - M, H - 66, 'For contracted instructors')

y = H - 126
def para(text, size=9.5, color=SLATE, gap=4, font='Helvetica'):
    global y
    c.setFont(font, size); c.setFillColor(color)
    for line in simpleSplit(text, font, size, W - 2 * M):
        c.drawString(M, y, line); y -= size + 3
    y -= gap

def section(title):
    global y
    y -= 6
    c.setFillColor(EMBER); c.rect(M, y - 2, 3, 13, fill=1, stroke=0)
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 11.5); c.drawString(M + 10, y, title)
    y -= 28

def field(name, label, x, w, tooltip=None, maxlen=None):
    c.setFillColor(SLATE); c.setFont('Helvetica', 8); c.drawString(x, y + 20, label)
    kw = dict(name=name, tooltip=tooltip or label, x=x, y=y - 2, width=w, height=18, borderWidth=0.8,
              borderColor=LINE, fillColor=HexColor('#F7F8FA'), textColor=INK, fontName='Helvetica', fontSize=10)
    if maxlen: kw['maxlen'] = maxlen
    f.textfield(**kw)

para('Fill this out, sign it, and upload it on the Application tab of the ResQ Instructor Portal. A voided check or a bank letter showing the '
     'routing and account numbers is optional but helps us avoid typos; upload it with the form if you have one. Please don\'t email this form. '
     'Uploads go to a locked folder only ResQ\'s payroll contact can open.')

section('1. Your information')
full = W - 2 * M
y -= 10; field('name', 'Full legal name', M, full * 0.6); field('phone', 'Phone', M + full * 0.62, full * 0.38); y -= 42
field('email', 'Email (the one you use for the portal)', M, full * 0.6); y -= 42
field('address', 'Mailing address', M, full); y -= 42

section('2. Bank account')
y -= 10; field('bank', 'Bank or credit union name', M, full * 0.6); field('acct_name', 'Name(s) on the account', M + full * 0.62, full * 0.38); y -= 42
field('routing', 'Routing number (9 digits)', M, full * 0.3, maxlen=9)
field('account', 'Account number', M + full * 0.33, full * 0.32)
field('account_confirm', 'Re-enter account number', M + full * 0.68, full * 0.32); y -= 40
c.setFillColor(SLATE); c.setFont('Helvetica', 8); c.drawString(M, y + 12, 'Account type')
for i, (val, lab) in enumerate([('Checking', 'Checking'), ('Savings', 'Savings')]):
    x = M + i * 110
    f.radio(name='account_type', tooltip='Account type', value=val, selected=False, x=x, y=y - 6, size=13, buttonStyle='circle',
            borderColor=SLATE, fillColor=white, textColor=INK, borderWidth=0.8, forceBorder=True)
    c.setFillColor(INK); c.setFont('Helvetica', 10); c.drawString(x + 18, y - 3, lab)
y -= 34

section('3. Authorization')
para('I authorize ResQ Education LLC to deposit payments for my contracted instructor work into the account above. '
     'If a deposit is made in error, I authorize ResQ Education LLC to make a correcting entry for that amount. '
     'This authorization stays in effect until I tell ResQ Education in writing to change or cancel it, with enough time for ResQ to act on it. '
     'I confirm that I am an owner or authorized signer on this account.', size=9.5, color=INK, gap=14)
y -= 10
field('signature', 'Signature (type your full name to sign)', M, full * 0.62); field('date', 'Date', M + full * 0.66, full * 0.34); y -= 40

c.setStrokeColor(LINE); c.line(M, y, W - M, y); y -= 16
c.setFillColor(INK); c.setFont('Helvetica-Bold', 9); c.drawString(M, y, 'For ResQ payroll only'); y -= 38
field('office_entered', 'Entered in payroll by', M, full * 0.45); field('office_date', 'Date entered', M + full * 0.5, full * 0.25); field('office_verified', 'Confirmed by phone (Y/N)', M + full * 0.78, full * 0.22)

c.setFillColor(SLATE); c.setFont('Helvetica', 7.5)
c.drawString(M, 36, 'ResQ Education LLC  ·  Confidential once completed. Keep a copy for your records.')
c.drawRightString(W - M, 36, 'Rev. 11/2026')
c.save()
print('wrote', OUT)
