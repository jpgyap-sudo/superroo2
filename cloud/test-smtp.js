const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || "smtp.gmail.com",
	port: parseInt(process.env.SMTP_PORT || "587"),
	secure: false,
	auth: {
		user: process.env.SMTP_USER || "",
		pass: process.env.SMTP_PASS || "",
	},
})

transporter
	.verify()
	.then(() => {
		console.log("SMTP CONNECTION OK")
		// Try sending a test email
		return transporter.sendMail({
			from: process.env.SMTP_FROM || "",
			to: "jpgyap@gmail.com",
			subject: "SuperRoo SMTP Test",
			text: "This is a test email from SuperRoo SMTP. If you receive this, SMTP is working correctly.",
		})
	})
	.then((info) => {
		console.log("Test email sent successfully! MessageId:", info.messageId)
		process.exit(0)
	})
	.catch((err) => {
		console.error("SMTP ERROR:", err.message || err)
		process.exit(1)
	})
