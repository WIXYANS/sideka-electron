import { remote, app as remoteApp, shell } from "electron";
import * as fs from "fs";

import { Siskeudes } from '../stores/siskeudes';
import dataApi from "../stores/dataApi";
import settings from '../stores/settings';
import schemas from '../schemas';

import { apbdesImporterConfig, Importer } from '../helpers/importer';
import { exportApbdes } from '../helpers/exporter';
import { initializeTableSearch, initializeTableCount, initializeTableSelected } from '../helpers/table';
import SumCounter from "../helpers/sumCounter";
import { Diff, DiffTracker } from "../helpers/diffTracker";
import titleBar from '../helpers/titleBar';

import { Component, ApplicationRef, NgZone, HostListener, ViewContainerRef } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { ToastsManager } from 'ng2-toastr';

var $ = require('jquery');
var path = require("path");
var jetpack = require("fs-jetpack");
var Docxtemplater = require('docxtemplater');
var Handsontable = require('./lib/handsontablep/dist/handsontable.full.js');

window['jQuery'] = $;
require('./node_modules/bootstrap/dist/js/bootstrap.js');
require('jquery-ui-bundle');

const APP = remote.app;
const APP_DIR = jetpack.cwd(APP.getAppPath());
const DATA_DIR = APP.getPath("userData");

const FIELDS = [{
    category: 'rincian',
    lengthCode: 1,
    fieldName: ['Kd_Rincian', 'Nama_Obyek', '', 'Sumberdana', 'Nilai'],
    currents: { fieldName: 'Kd_Rincian',  value: '', code: '' }
}, {
    category: 'pengeluaran',
    lengthCode: 2,
    fieldName: ['No_Bukti', 'Keterangan_Bukti', 'Tgl_Bukti', '', 'Nilai_SPP_Bukti', 'Nm_Penerima', 'Alamat', 'Nm_Bank', 'Rek_Bank', 'NPWP'],
    currents: { fieldName: 'No_Bukti',  value: '', code: ''}
}, {
    category: 'potongan',
    lengthCode: 3,
    fieldName: ['Kd_Potongan', 'Nama_Obyek', '', '', 'Nilai_SPPPot'],
    currents: { fieldName: 'Kd_Potongan',  value: '', code: '' }
}];

const FIELD_WHERE = {
    Ta_SPPRinci: ['Kd_Desa', 'No_SPP', 'Kd_Keg', 'Kd_Rincian'],
    Ta_SPPBukti: ['Kd_Desa', 'No_Bukti'],
    Ta_SPPPot: ['Kd_Desa', 'No_SPP', 'No_Bukti', 'Kd_Rincian']
}

const POTONGAN_DESCS = [{ code: '7.1.1.01.', value: 'PPN' }, { code: '7.1.1.02.', value: 'PPh Pasal 21' }, { code: '7.1.1.03.', value: 'PPh Pasal 22' }, { code: '7.1.1.04.', value: 'PPh Pasal 23' }]
const JENIS_SPP = { UM: 'Panjar', LS: 'Definitif', PBY: 'Pembiayaan' }

var sheetContainer;

@Component({
    selector: 'spp',
    templateUrl: 'templates/spp.html',
    host: {
        '(window:resize)': 'onResize($event)'
    }
})

export default class SppComponent {
    hot: any;
    siskeudes: any;
    sub: any;
    hots: any = {};
    contentSelection: any = {};
    potonganDesc: string;
    isExist: boolean;
    message: string;
    refDatasets: any = {};
    initialData: any;
    kdKegiatan: string;
    diffTracker: DiffTracker;
    afterSaveAction: string;
    isDetailSPPEmpty: boolean;
    isEmptyPosting: boolean;
    SPP: any = {};
    model: any= {};
    posting = {};
    sisaAnggaran: any[];

    constructor(private appRef: ApplicationRef, private zone: NgZone, private route: ActivatedRoute, public toastr: ToastsManager, vcr: ViewContainerRef) {
        this.appRef = appRef;
        this.zone = zone;
        this.route = route;        
        this.siskeudes = new Siskeudes(settings.data["siskeudes.path"]);
        this.diffTracker = new DiffTracker();      
        this.toastr.setRootViewContainerRef(vcr);  
    }

    redirectMain(): void {
        //this.hot.sumCounter.calculateAll();
        this.afterSaveAction = 'home';

        document.location.href = "app.html";
    }

    forceQuit(): void {
        document.location.href="app.html";
    }

    afterSave(): void {
        if (this.afterSaveAction == "home")
            document.location.href = "app.html";
        else if (this.afterSaveAction == "quit")
            APP.quit();
    }

    initSheet(sheetContainer) {
        let me = this;
        let config = {
            data: [],
            topOverlay: 34,

            rowHeaders: true,
            colHeaders: schemas.getHeader(schemas.spp),
            columns: schemas.spp,

            colWidths: schemas.getColWidths(schemas.spp),
            rowHeights: 23,

            columnSorting: true,
            sortIndicator: true,
            outsideClickDeselects: false,
            autoColumnSize: false,
            search: true,
            schemaFilters: true,
            contextMenu: ['undo', 'redo', 'row_above', 'remove_row'],
            dropdownMenu: ['filter_by_condition', 'filter_action_bar']
        }
        let result = new Handsontable(sheetContainer, config);
        /*
        result.sumCounter = new SumCounter(result, 'spp');

        result.addHook('afterChange', function (changes, source) {
            if (source === 'edit' || source === 'undo' || source === 'autofill') {
                var rerender = false;
                changes.forEach(function (item) {
                    var row = item[0],
                        col = item[1],
                        prevValue = item[2],
                        value = item[3];

                    if (col == 5) {
                        rerender = true;
                    }
                });
                if (rerender) {
                    result.sumCounter.calculateAll();
                    result.render();
                }
            }
        });
        */
        return result;
    }

    onResize(event) {
        let me = this;
        setTimeout(function () {
            me.hot.render();
        }, 200);
    }

    ngOnInit() {                
        this.posting = {};
        this.isEmptyPosting = false
        this.isExist = false;
        this.kdKegiatan = null;
      
        this.sub = this.route.queryParams.subscribe(params => {
            let sheetContainer = document.getElementById("sheet-spp");
            titleBar.blue(`SPP ${JENIS_SPP[params['jenis_spp']] } -`  + dataApi.getActiveAuth()['desa_name']);            

            this.hot = this.initSheet(sheetContainer);
            this.SPP['noSPP'] = params['no_spp'];
            this.SPP['kdDesa'] = params['kd_desa'];
            this.SPP['tahun'] = params['tahun'];
            this.SPP['jenisSPP'] = params['jenis_spp'];
            this.SPP['tanggalSPP'] = params['tanggal_spp'];

            this.getContent();
        });
    }

    getContent(){
        let me = this;

        this.siskeudes.getPostingLog(this.SPP.kdDesa, data => {
            let kdPostingSelected;
            this.isEmptyPosting = true;

            data.forEach(c => {
                if(c.KdPosting == 3)
                    return;
                
                if(c.KdPosting == 1 && kdPostingSelected !== 2){
                    this.posting = c;
                    this.isEmptyPosting = false;
                    kdPostingSelected = 1;
                }
                else if(c.KdPosting == 2){
                    this.posting = c;
                    this.isEmptyPosting = false;
                    kdPostingSelected = 2;
                }
            });

            if(!kdPostingSelected)
                this.toastr.error('Harap Posting APBDes Awal Tahun Terlebih Dahulu Untuk Menambah Rincian', '')
            else {
                let datePosting = moment(this.posting['TglPosting'], "DD-MM-YYYY");
                let dateSPP = moment(this.SPP.tanggalSPP, "DD-MM-YYYY");

                if(datePosting > dateSPP){
                    this.toastr.error('Tidak Bisa menambah Rincian Karena Tanggal SPP Dibuat Sebelum Tanggal Posting', '')
                    this.isEmptyPosting = true;
                }
            }            

            this.siskeudes.getDetailSPP(this.SPP.noSPP, detail => {
                this.isDetailSPPEmpty = true;
                let results = [];

                if(detail.length !== 0){
                    results = this.transformData(detail);

                    this.isDetailSPPEmpty = false;
                    this.initialData = results.map(c => c.slice());   
                    this.kdKegiatan = detail[0].Kd_Keg;
                    this.getSisaAnggaran(this.kdKegiatan, data =>{

                    });             
                }   

                this.hot.loadData(results);                             
                this.getReferences();

                setTimeout(function () {
                    me.hot.render();
                }, 200);
            })
        })  
    }

    getSisaAnggaran(kdKegiatan, callback){
        this.siskeudes.getSisaAnggaranRAB(kdKegiatan, this.posting['KdPosting'], data => {
            this.sisaAnggaran = data;
            callback(data);
        });
    }

    transformData(data){
        let results = [];
         data.forEach(content => {
            let temp = [];

            FIELDS.forEach((item, idx) => {
                let res = [];
                let current = item.currents;

                if (content[current.fieldName] || content[current.fieldName] !== null) {

                    for (let i = 0; i < item.fieldName.length; i++) {
                        let contentPush = (item.fieldName[i] == '') ? '' : content[item.fieldName[i]];

                        if (item.fieldName[i] == 'Nilai'){
                            if(item.category == 'rincian' && this.SPP.jenisSPP !== 'UM')
                                continue;
                        }

                        res.push(contentPush);
                    }

                    if (current.value != content[current.fieldName]) {
                        if(FIELDS[idx + 1]) 
                            FIELDS[idx + 1].currents.code = '';

                        temp.push(res);
                    };
                    current.value = content[current.fieldName];
                }
            });
            temp.map(c => results.push(c))
        });
            
        return results;
    }

    saveContent() {
        let bundleSchemas = {};
        let bundleData = {};
        let me = this;
        let bundleName = 'perencanaan';

        let sourceData = this.getSourceDataWithSums();
        let initialDataset = this.initialData;

        let diffcontent = this.trackDiff(initialDataset, sourceData);

        if (diffcontent.total < 1) return;
        let bundle = this.bundleData(diffcontent);

        dataApi.saveToSiskeudesDB(bundle, null, response => {
        });
    };

    trackDiff(before, after): Diff {
        return this.diffTracker.trackDiff(before, after);
    }

    bundleData(bundleDiff): any {
        let tables = ['Ta_RPJM_Misi', 'Ta_RPJM_Tujuan', 'Ta_RPJM_Sasaran'];
        let extendCol = { Kd_Desa: this.SPP.kdDesa, No_SPP: this.SPP.noSPP, Tahun: this.SPP.tahun, Kd_Keg: this.kdKegiatan }
        let bundleData = {
            insert: [],
            update: [],
            deleted: []
        };

        bundleDiff.added.forEach(content => {
            let result = this.bundleArrToObj(content);

            Object.assign(result.data, extendCol)
            bundleData.insert.push({ [result.table]: result.data })
        });

        bundleDiff.modified.forEach(content => {
            let results = this.bundleArrToObj(content);
            let res = { whereClause: {}, data: {} }

            FIELD_WHERE[results.table].forEach(c => {
                res.whereClause[c] = results.data[c];
            });

            res.data = this.sliceObject(results.data, FIELD_WHERE[results.table]);
            bundleData.update.push({ [results.table]: res })
        });

        return bundleData;
    }

    bundleArrToObj(content) {
        enum Tables { Ta_SPPRinci = 1, Ta_SPPBukti = 2, Ta_SPPPot = 3 };

        let result = {};
        let dotCount = content[0].split('.').length;
        let field = FIELDS.find(c => c.lengthCode == dotCount).fieldName;
        let data = this.arrayToObj(content, field);

        return { table: Tables[dotCount], data: data }
    }

    parsingCode(code) {
        let sourceData = this.hot.getSourceData();
        let codes = code.split('.');
        let res = {}
        enum Id { No_Bukti = 2, Kd_Rincian = 3 }

        for (let i = 0; i < sourceData.length; i++) {
            let codes = sourceData[i][0];
            let dotCount = code.split('.').length;
            let data = schemas.arrayToObj(sourceData[i], schemas.spp)

            if (codes == 2)
                res['No_Bukti'] = sourceData[i];
        }

    }

    sliceObject(obj, values) {
        let res = {};
        let keys = Object.keys(obj);

        for (let i = 0; i < keys.length; i++) {
            if (values.indexOf(keys[i]) !== -1) continue;
            res[keys[i]] = obj[keys[i]]
        }
        return res;
    }

    arrayToObj(arr, schema) {
        let result = {};
        for (var i = 0; i < schema.length; i++) {
            if (schema[i] == '') continue;
            result[schema[i]] = arr[i + 1];
        }

        return result;
    }

    getSourceDataWithSums(): any {
        let x = new SumCounter(this.hot, 'spp')
        let rows: any[] = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
        let sums = {};
        let data;

        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];

            if (row.kode_rekening && !sums[row.kode_rekening])
                row.anggaran = x.getValue(row, i, rows);
        }

        return rows.map(o => schemas.objToArray(o, schemas.spp));
    }

    openAddRowDialog() {
        this.model = {};
        this.contentSelection = {};      
        this.isExist = false  

        let selected = this.hot.getSelected();
        let category = 'rincian';
        let sourceData = this.hot.getSourceData();

        if (selected && this.SPP.jenisSPP !== 'UM') {
            let data = this.hot.getDataAtRow(selected[0]);
            let dotCount = data[0].split('.').length;
            let code = data[0];

            if(code.startsWith('5.') && dotCount == 4)
                category = 'pengeluaran';
            else
                category = 'potongan';
        }
        this.model.category = category;
        this.setDefaultValue();       

        $("#modal-add").modal("show");
        (sourceData.length == 0 && category == 'rincian' ) ? this.categoryOnChange(category) : this.getKodeKegAndChange();
    }

    addRow() {
        let me = this;
        let position = 0;
        let results = [];
        let data = this.model;
        let currentCode, lastCode;
        let sourceData = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
        let currentField = FIELDS.filter(c => c.category == this.model.category).map(c => c.fieldName)[0];
        
        switch (this.model.category){
            case 'rincian': 
                position = sourceData.length;
                let detailRincian = this.sisaAnggaran.find(c => c.Kd_Rincian == this.model.Kd_Rincian);
                Object.assign(data, detailRincian);
                
                break;
            case 'pengeluaran':
                let kdRincian = ""; 

                sourceData.forEach((c, i) => {
                    if(c.code.startsWith('5.') && c.code.split('.').length == 5)
                        kdRincian = c.code;
                    if(kdRincian == this.model.Kd_Rincian)
                        position = i+1;
                });

                data.Tgl_Bukti = moment(data.Tgl_Bukti, "YYYY-MM-DD").format("DD/MM/YYYY");
                break;
            case 'potongan':
                let buktiPengeluaran = '';
                sourceData.forEach((c, i) => {
                    if(!(c.code.startsWith('5.') && c.code.startsWith('7.')) && c.code.split('.').length != 5)
                        kdRincian = c.code;
                    if(buktiPengeluaran == this.model.No_Bukti)
                        position = i+1;
                });
                Object.assign(data, this.refDatasets.find(c => c.Kd_Potongan == data.Kd_Potongan))
                break;
        }
        currentField.forEach(f => {
            results.push(data[f])
        });

        if(data.category == 'pengeluaran'){
            let rincian = this.sisaAnggaran.find(c => c.Kd_Rincian == data.Kd_Rincian);
            rincian.Sisa = rincian.Sisa - data.Nilai_SPP_Bukti
        }

        this.isEmptyPosting = false;
        this.hot.alter("insert_row", position);
        this.hot.populateFromArray(position, 0, [results], position, results.length-1, null, 'overwrite');
        setTimeout(function () {
            me.hot.render();
        }, 300);
    }

    addOneRow(): void { 
        let isValid = this.validate();

        if(isValid){
            this.addRow();
            $("#modal-add").modal("hide");
        }
    }

    addOneRowAndAnother(): void {
        let isValid = this.validate();

        if(isValid){
            this.addRow();
            $("#modal-add").modal("hide");
        }
    }

    categoryOnChange(value): void {
        this.isExist = false;
        this.setDefaultValue();

        if(value == 'rincian'){
            let sourceData = this.hot.getSourceData();

            if(sourceData.length == 0){
                 this.kdKegiatan = null;
                 this.contentSelection['allKegiatan'] = this.refDatasets["allKegiatan"];
            }
            else 
                this.getKodeKegAndChange();
            
        }
        else {
            let sourceData = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
            let rincian = sourceData.filter(c => c.code.startsWith('5.') && c.code.split('.').length == 5);

            this.contentSelection['availableRincian'] = rincian;
            this.model.No_Bukti = '00000/KWT/' + this.SPP.kdDesa + this.SPP.tahun;               
        }
    }

    getKodeKegAndChange(): void {
        let sourceData = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
        let row = sourceData.filter(c => c.code.startsWith('5.') && c.code.split('.').length == 5);
        let code = row[0].code;

        if(code == '')
            return;

        this.siskeudes.getKegiatanByCodeRinci(code, data => {
            this.kdKegiatan = data[0].Kd_Keg;
            this.selectedOnChange(this.kdKegiatan);
        });
    }

    selectedOnChange(value): void {
        let sourceData = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
        switch (this.model.category) {
            case 'rincian':
                this.contentSelection["rincianRAB"] = []; 

                if(!this.sisaAnggaran || this.sisaAnggaran.length == 0){
                    this.getSisaAnggaran(value, data => {
                        let rincianAdded = sourceData.filter(c => c.code.split('.').length == 5 && c.code.startsWith('5.'));

                        this.sisaAnggaran.forEach(rinci => {
                            if(!rincianAdded.find(c => c.code == rinci.Kd_Rincian))
                                this.contentSelection["rincianRAB"].push(rinci)
                        });
                    })
                }
                else {
                    let rincianAdded = sourceData.filter(c => c.code.split('.').length == 5 && c.code.startsWith('5.'));

                    this.sisaAnggaran.forEach(rinci => {
                        if(!rincianAdded.find(c => c.code == rinci.Kd_Rincian))
                            this.contentSelection["rincianRAB"].push(rinci)
                    });
                }
                break;

            case 'potongan':
                let results = [];
                let kdRincian = '';
                sourceData.forEach(c => {
                    if(c.code.split('.').length == 5 && c.code.startsWith('5.'))
                        kdRincian = c.code;

                    if(this.model.Kd_Rincian == kdRincian && !c.code.startsWith('7.') ){
                        results.push()
                    }                       
                    
                });
                this.contentSelection['availablePengeluaran'] = results;
                break;
        }
    }

    validate(){
        let isValidForm = this.validateForm();
        let isExist = this.validateIsExist();

        if(isExist && this.model.category !== 'rincian'){
            let messageFor = (this.model.category == 'pengeluaran') ? 'No Bukti Pengeluaran' : 'No Potongan';

            this.toastr.error(`${messageFor} Ini sudah ditambahkan`)
            return false;
        }

        if(this.isExist)
            return false;

        if(isValidForm){
            let isEnoughAnggaran = false;
            if(this.model.category == 'pengeluaran'){
                isEnoughAnggaran = this.validateSisaAnggaran();
            }

            if(isEnoughAnggaran){
                this.toastr.error('Sisa Anggaran Tidak mencukupi','')
                return false;
            }            
            return true;
        } 
        return false;
    }

    validateIsExist() {
        let sourceData = this.hot.getSourceData().map(a => schemas.arrayToObj(a, schemas.spp));
        let isExist = false;

        if(this.model.category == 'pengeluaran'){
            let kdRincian = '';
            let code = this.model.No_Bukti;
            for(let i = 0; i < sourceData.length; i++){
                let row = sourceData[i];

                if(row.code.split('.').length == 5 && row.code.startsWith('5.'))
                    kdRincian = row.code;

                if(kdRincian == this.model.Kd_Rincian){
                    if(code == row.code){
                        isExist = true;
                        break;
                    }
                }
            }
        }
        return isExist;
    }

    validateForm(){
        let fields = [];
        let result = true;

        switch(this.model.category){
            case 'rincian': 
                fields.push({name: 'Rincian', field: 'Kd_Rincian'});

                if(this.kdKegiatan == "")
                    this.toastr.error('Kegiatan Tidak Boleh Kosong!','');
                if(this.SPP.jenisSPP == 'UM')
                    fields.push({name: 'Nilai', field: 'Nilai'});

                break;
            case 'pengeluaran':
                fields.push(
                    {name: 'Rincian', field: 'Kd_Rincian'}, 
                    {name: 'Tanggal', field: 'Tgl_Bukti'},
                    {name: 'Nomor Bukti', field: 'No_Bukti'},
                    {name: 'Nm Penerima', field: 'Nm_Penerima'},
                    {name: 'Uraian', field: 'Keterangan_Bukti'}  
                ); 
                let year = this.model.Tgl_Bukti = moment(this.model.Tgl_SPP, "YYYY-MM-DD").year();
                if(this.SPP.tahun < year){
                    this.toastr.error('Tahun Tidak Sama Dengan Tahun Anggaran','');
                    result = false;
                }

                break;
        }
        
        fields.forEach(c => {
            if(this.model[c.field] == null || this.model[c.field] == "" || this.model[c.field] == 'null'){
                this.toastr.error(`${c.name} Tidak boleh Kosong`,``);
                result = false;
            }
        })

        return result;
    }

    validateSisaAnggaran(){   
        let result = false;     
        let rincian = this.sisaAnggaran.find(c => c.Kd_Rincian == this.model.Kd_Rincian);
        let sisaAnggaran = rincian.Sisa - this.model.Nilai_SPP_Bukti;

        if(sisaAnggaran < 0){
            result = true;
        }
        
        return result;
    }

    getReferences(): void {
        this.siskeudes.getRefPotongan(data => {
            this.refDatasets["potongan"] = data;
        })

        this.siskeudes.getAllKegiatan(this.SPP.kdDesa, data => {
            let isUsulanApbdesOnly = true;
            let results = [];

            if(this.posting['KdPosting'])

            if(isUsulanApbdesOnly){
                results = data.filter(c => {
                    let endCode = c.Kd_Keg.slice(-3);
                    let filters = ['01.','02.','03.'];

                    if(filters.indexOf(endCode) !== -1)
                        return c
                })
            }
            else 
                results = data;

            this.refDatasets["allKegiatan"] = results;
        })
    }

    setDefaultValue(){
        let fields =  [];
        switch(this.model.category){
            case 'rincian':
                fields = ['Kegiatan', 'Kd_Rincian'];
                break;
            case 'pengeluaran':
                this.model.Nilai_SPP_Bukti = 0;
                fields = ['Kd_Rincian'];
                break;
            case 'potongan':
                this.model.Nilai_SPPPot = 0;
                fields = ['Kd_Rincian','Bukti_Pengeluaran','Kd_Potongan'];
                break
        }

        fields.forEach( c => {
            this.model[c] = null;
        })
    }
}
