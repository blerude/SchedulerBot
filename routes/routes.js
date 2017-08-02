var express = require('express');
var router = express.Router();
var models = require('../models');
var User = models.User;
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var axios = require('axios');

//////////////////////////////// PUBLIC ROUTES ////////////////////////////////
// Users who are not logged in can see these routes

var oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/googleauth/callback'
);

google.options({
  auth: oauth2Client
});

router.get('/googleoauth', (req, res) => {
  console.log('ID', process.env.GOOGLE_CLIENT_ID);
  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/plus.me'
    ],
    state: encodeURIComponent(JSON.stringify({
      auth_id: req.query.auth_id,
      subject: req.query.subject,
      date: req.query.date
    }))
  });
  console.log('URL', url);
  res.redirect(url);
})

var addEvent = (subject, start, end) => {
  console.log('IN FUNCTION');
  var event = {
    summary: subject,
    // location: '800 Howard St., San Francisco, CA 94103',
    // description: 'A chance to hear more about Google\'s developer products.',
    start: {
      dateTime: new Date(start),
      timeZone: 'America/Los_Angeles'
    },
    end: {
      dateTime: new Date(end),
      timeZone: 'America/Los_Angeles'
    }
  };

  var calendar = google.calendar('v3');
  calendar.events.insert({
    auth: oauth2Client,
    calendarId: 'primary',
    resource: event,
  }, function(err, e) {
    if (err) {
      console.log('ERROR', err);
      return;
    }
    console.log('Event created: %s', e.htmlLink);
  });
}

router.get('/googleauth/callback', (req, res) => {

  if (!req.query.state) {
    console.log('AUTHORIZED', req.query);
    var startDate = new Date(req.query.date).getTime();
    var endDate = startDate + (24 * 60 * 60 * 1000);
    addEvent(req.query.subject, startDate, endDate);
    res.send('Event added!');
  } else {
    console.log('NOTAUTHORIZED', JSON.parse(decodeURIComponent(req.query.state)));
    oauth2Client.getToken(req.query.code, (err, tokens) => {
      // tokens contains an access_token and an optional refresh_token
      if (!err) {
        console.log('TOKEN', tokens);
        oauth2Client.setCredentials(tokens);
        User.findOne({ slackId: JSON.parse(decodeURIComponent(req.query.state)).auth_id })
          .then(user => {
            console.log('FOUND USER!', user);
            user.tokens = tokens;
            user.save()
              .then(user => {
                console.log('SAVED', user);
                var state = JSON.parse(decodeURIComponent(req.query.state));
                var startDate = new Date(state.date).getTime();
                var endDate = startDate + (24 * 60 * 60 * 1000);
                addEvent(state.subject, startDate, endDate);
              })
          })
          .catch(err => {
            console.log('ERROR', err);
          })
        }
    });
    res.redirect('https://calendar.google.com/calendar');
  }
})

router.post('/interactive', (req, res) => {
  console.log('IN INTERACTIVE');
  var string = JSON.parse(req.body.payload);
  User.findOne({slackId: string.user.id}, function(err, messager) {
    if (string.actions[0].value === 'cancel') {
      res.send('Scheduler cancelled');
    } else {
      var pending = JSON.parse(messager.pending)
      new Reminder({
        subject: pending.subject,
        date: pending.date,
        user: messager._id
      }).save()
      console.log('CONFIRMED', pending);
      if (Object.keys(messager.tokens).length > 0 && messager.tokens.expiry_date > new Date().getTime()) {
        res.redirect(`/googleauth/callback?subject=${pending.subject}&date=${pending.date}`);
      } else {
        res.send(`http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${pending.subject}&date=${pending.date}`);
      }
    }
    messager.pending = '';
    messager.save();
  })
})


module.exports = router;
