/* jshint node: true */
/* jshint esnext: true */
'use strict';

const _ = require('lodash');
const Q = require('q');
const moment = require('moment');
require("moment-duration-format");
const participants = require('../service/participants');
const tshirts = require('../service/tshirts');

const editUrlHelper = require('../domain/editUrlHelper');
const timeCalculator = require('../domain/timeCalculator');

let pdfGeneration = {};

let getParticipants = () => {
  return Q.all([participants.get.confirmed(), participants.get.registered()])
    .then(results => _.concat(results[0], results[1]))
    .then(participants => Q.all(participants.map(tshirts.findAndAddTo)));
};

let getBlancParticipants = () => {
  return participants.get.blancParticipants();
};

pdfGeneration.extractData = (participant) => {
  return {
    startNumber: _.toString(participant.start_number),
    firstname: participant.firstname,
    team: participant.team,
    startBlock: _.toString(participant.start_block), //be careful not to use the id as the block name
    tshirt: participant.tshirt,
    hasPayed: participant.has_payed,
    onSiteRegistration: participant.is_on_site_registration,
    secureUrl: editUrlHelper.generateUrl(participant.secureid)
  };
};

pdfGeneration.generateStartNumbers = (redis) => {
  return getParticipants()
    .then((participants) => {
        let msgs = participants.map(pdfGeneration.extractData);
        _.forEach(msgs, m => redis.publish('pace-pdf', m));
      }
    );
};

pdfGeneration.generateOnSiteStartNumbers = (redis) => {
  return getBlancParticipants()
    .then((participants) => {
        let msgs = participants.map(pdfGeneration.extractData);
        _.forEach(msgs, m => redis.publish('pace-pdf', m));
      }
    );
};

//todo how should we deal with this
// [ ] first move to certificates.js
const pathToCertificateBackgroundImage = '/images/certificate_background.jpg';
const PDFDocument = require('pdfkit');

pdfGeneration.createCertificatePage = (doc, participant) => {
  const deferred = Q.defer();
  participants.rankByCategory(participant.start_number).then(category_rank => {
    participants.rank(participant.start_number).then(rank => {
      participants.getTime(participant.start_number).then(time => {
        if (_.isNull(time)) {
          deferred.reject();
        } else {
          let timestring = moment.duration(_.toNumber(participant.seconds), 'seconds').format("hh:mm:ss", {trim: false});
          doc.image(__dirname + pathToCertificateBackgroundImage, {fit: [595, 842]});
          doc.fontSize(30).fillColor('black').text(participant.firstname.substring(0, 30) + ' ' + participant.lastname.substring(0, 30), 0, 365, {align: 'center'});
          doc.fontSize(25).fillColor('black').text(participant.team.substring(0, 60), 0, 400, {align: 'center'});
          doc.fontSize(30).fillColor('black').text(timestring, 0, 487, {align: 'center'});
          doc.fontSize(30).fillColor('black').text(rank, 0, 558, {align: 'center'});
          doc.fontSize(30).fillColor('black').text(category_rank, 0, 628, {align: 'center'});
          deferred.resolve();
        }
        ;
      });
    });
  });
  return deferred.promise;
};

pdfGeneration.generateCertificateDownload = (res, doc, startnumber) => {
  const deferred = Q.defer();
  participants.get.byStartnumber(startnumber).then(participant => {
    pdfGeneration.createCertificatePage(doc, participant)
      .then(() => {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Access-Control-Allow-Origin': '*',
          'Content-Disposition': 'attachment; filename=' + 'urkunde.pdf'
        });
        doc.pipe(res);
        doc.end();
        deferred.resolve(doc);
      }).catch(deferred.reject);
  }).catch(deferred.reject);
  return deferred.promise;
};

pdfGeneration.generateCertificate = (res, startnumber) => {
  let doc = new PDFDocument({size: 'A4', margin: 0});
  return pdfGeneration.generateCertificateDownload(res, doc, startnumber);
};

module.exports = pdfGeneration;
