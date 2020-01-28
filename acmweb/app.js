//jshint esversion:6
const express = require("express"),
  app = express(),
  path = require("path"),
  admin = require("firebase-admin"),
  bodyParser = require("body-parser"),
  firebase = require("firebase")
	require("firebase/auth"),
  staging = false, //If staging set it to TRUE
  qs = require("querystring"),
  nodemailer = require("nodemailer"),
  sendGridTransport = require("nodemailer-sendgrid-transport"),
  port = process.env.PORT || 3000,
  fs = require('fs'),
  PDFDocument = require('pdfkit'),
  https = require("https");

let newUser = {};

//Rendering of ejs templates
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(
  bodyParser.urlencoded({
    extended: true
  })
);

app.use(bodyParser.json());

//Routes
app.get("/", (req, res) => {
  res.render("home", {
    submission: "unsuccessfull"
  });
});

app.get("/paytm", (req, res) => {
  let params = {};
  params["MID"] = PaytmConfig.mid;
  params["WEBSITE"] = PaytmConfig.website;
  params["CHANNEL_ID"] = "WEB";
  params["INDUSTRY_TYPE_ID"] = "Retail";
  params["ORDER_ID"] = staging
    ? "TEST_" + new Date().getTime()
    : "PROD_" + new Date().getTime();
  params["CUST_ID"] = "Cust_" + new Date().getTime();
  params["TXN_AMOUNT"] = "";
  params["CALLBACK_URL"] = staging
    ? "http://localhost:3000/"
    : "https://ugh-workshop.herokuapp.com/";
  params["EMAIL"] = "";
  params["MOBILE_NO"] = "";
  // console.log(newUser.mtype().toLowerCase());
  if (newUser.mtype.toLowerCase().includes("yes")) {
    params["TXN_AMOUNT"] = "200.00";
  } else if (newUser.mtype.toLowerCase().includes("no")) {
    params["TXN_AMOUNT"] = "400.00";
  }

  checksum_lib.genchecksum(params, PaytmConfig.key, function(err, checksum) {
    var txn_url = staging
      ? "https://securegw-stage.paytm.in/theia/processTransaction"
      : "https://securegw.paytm.in/theia/processTransaction";

    var form_fields = "";
    for (var x in params) {
      form_fields +=
        "<input type='hidden' name='" + x + "' value='" + params[x] + "' >";
    }
    form_fields +=
      "<input type='hidden' name='CHECKSUMHASH' value='" + checksum + "' >";

    res.writeHead(200, {
      "Content-Type": "text/html"
    });
    res.write(
      '<html><head><title>Merchant Checkout Page</title></head><body><center><h1>Please do not refresh this page...</h1></center><form method="post" action="' +
        txn_url +
        '" name="f1">' +
        form_fields +
        '</form><script type="text/javascript">document.f1.submit();</script></body></html>'
    );
    res.end();
  });
});

app.post("/", (req, res) => {
  console.log("Reached the post route");
  if (req.body.name) {
    console.log("Name found");
    newUser = {
      name: req.body.name,
      branch: req.body.branch,
      year: req.body.year,
      sapid: req.body.sapid,
      email: req.body.email,
      pnum: req.body.pnum,
      wnum: req.body.wnum,
      mtype: req.body.mtype
    };
    console.log(newUser);
    // if(newUser.mtype.toLowerCase() == 'no'){
    res.redirect("/paytm");
    // }
    // else{
    //   timeReg = `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}  ${new Date().getHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}`;
    //   writeUserData(newUser,"",timeReg);
    // }

    res.redirect();
  }

  console.log("In post route of callback");
  var body = "";

  const data = req.body;

  console.log("Data written");
  body = JSON.stringify(data);

  var post_data = JSON.parse(body);

  console.log(post_data);

  // received params in callback
  timeReg = post_data["TXNDATE"];
  transID = post_data["TXNID"];
  ordID = post_data["ORDER_ID"];

  // verify the checksum
  var checksumhash = post_data.CHECKSUMHASH;
  // delete post_data.CHECKSUMHASH;
  const result = checksum_lib.verifychecksum(
    post_data,
    PaytmConfig.key,
    checksumhash
  );

  // Send Server-to-Server request to verify Order Status
  var params = {
    MID: PaytmConfig.mid,
    ORDERID: post_data.ORDERID
  };

  checksum_lib.genchecksum(params, PaytmConfig.key, function(err, checksum) {
    params.CHECKSUMHASH = checksum;
    post_data = "JsonData=" + JSON.stringify(params);

    var options = {
      hostname: staging ? "securegw-stage.paytm.in" : "securegw.paytm.in",
      port: 443,
      path: "/merchant-status/getTxnStatus",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": post_data.length
      }
    };

    // Set up the request
    var response = "";
    var post_req = https.request(options, post_res => {
      post_res.on("data", chunk => {
        response += chunk;
      });

      post_res.on("end", function() {
        var _result = JSON.parse(response);

        const status = _result["STATUS"];
        if (status == "TXN_SUCCESS") {
          console.log("Transaction Successfull");
          writeUserData(newUser, transID, timeReg, params.ORDERID);
        } else {
          console.log("Transaction unsuccessfull");
          res.render("home", {
            submission: "notregistered"
          });
        }

        res.end();
      });
    });

    // post the data
    post_req.write(post_data);
    post_req.end();
  });

  function writeUserData(newUser, transID = "", timeReg, ordID) {
    // console.log(newUser);
    admin
      .database()
      .ref("UGH_WORKSHOP_1/" + newUser.sapid)
      .set({
        name: newUser.name,
        branch: newUser.branch,
        year: newUser.year,
        sap: newUser.sapid,
        email: newUser.email,
        contact: newUser.pnum,
        whatsappNo: newUser.wnum,
        membershipType: newUser.mtype,
        transactionID: transID,
        registrationTime: timeReg,
        orderID: ordID
      })
      .then(() => {
        console.log("Data added");
        console.log(newUser);

        //Nodemailer start

        let options = {
          auth: {
            api_key:
              "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"
          }
        };

        let client = nodemailer.createTransport(sendGridTransport(options));

        let email = {
          from: "members.acm@gmail.com",
          to: newUser.email,
          subject: "Welcome to UPES-ACM and ACM-W",
          html: `<body style="margin: 0; padding: 0;">
                        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600">
                          <tr>
                            <td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                  <td style="padding: 20px 0 30px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;" "="">
                                    You've successfully registered for UGH workshop happening on 28th September 2019
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <tr>
                            <td bgcolor="#166baf" style="padding: 30px 30px 30px 30px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <td width="100%" style="align: right">
                                  Copyright &copy;<script>document.write(new Date().getFullYear());</script> All rights reserved | Designed and Developed by <a href="http://www.upesacm.org/" style="color:white" ;=""> UPES ACM Web Development Team </a><br>
                                </td>
                              </table>
                            </td>
                          </tr>
                        </table>

                      </body>`,
        };

        client.sendMail(email, (err, info) => {
          if (err) {
            console.log(err);
          }
          // fs.unlinkSync('file.pdf');
          console.log(info);
        });
      })
      .catch(err => {
        console.log("Error occured :");
        console.log(err);
      });

    res.render("home", {
      submission: "successfull"
    });
    res.end();
  }
});

//Start server
app.listen(port, () => console.log("Server listening on port ", port));
