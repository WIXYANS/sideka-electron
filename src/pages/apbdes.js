import { Component, ApplicationRef, NgZone } from '@angular/core';

import path from 'path';
import fs from 'fs';
import $ from 'jquery';
import { remote, app, shell } from 'electron'; // native electron module
import jetpack from 'fs-jetpack'; // module loaded from npm
import Docxtemplater from 'docxtemplater';
var Handsontable = require('./handsontablep/dist/handsontable.full.js');
import { importApbdes } from '../helpers/importer';
import { exportApbdes } from '../helpers/exporter';
import dataapi from '../stores/dataapi';
import schemas from '../schemas';
import { initializeTableSearch, initializeTableCount, initializeTableSelected } from '../helpers/table';
import diffProps from '../helpers/apbdesDiff';

window.jQuery = $;
require('./node_modules/bootstrap/dist/js/bootstrap.js');

var app = remote.app;
var hot;

var init = function() {
    window.addEventListener('resize', function(e){
        if(hot)
            hot.render();
    })
    $('.modal').each(function(i, modal){
        $(modal).on('hidden.bs.modal', function () {
            if(hot)
                hot.listen();
        })
    });
    schemas.registerCulture(window);
}

var initSheet = function (subType) {
    var sheetContainer = document.getElementById('sheet-'+subType);
    return new Handsontable(sheetContainer, {
        data: [],
        topOverlay: 34,

        rowHeaders: true,
        colHeaders: schemas.getHeader(schemas.apbdes),
        columns: schemas.apbdes,

        colWidths: schemas.getColWidths(schemas.apbdes),
        rowHeights: 23,
        
        //columnSorting: true,
        //sortIndicator: true,
        
        renderAllRows: false,
        outsideClickDeselects: false,
        autoColumnSize: false,
        search: true,
        //filters: true,
        contextMenu: ['row_above', 'remove_row'],
        //dropdownMenu: ['filter_by_condition', 'filter_action_bar'],
    });
};

var isCodeLesserThan = function(code1, code2){
    if(!code2)
        return false;
    var splitted1 = code1.split(".").map(s => parseInt(s));
    var splitted2 = code2.split(".").map(s => parseInt(s));
    var min = Math.min(splitted1.length, splitted2.length);
    for(var i = 0; i < min; i++){
        if(splitted1[i] > splitted2[i]){ 
            return false;
        }
        if(splitted1[i] < splitted2[i]){ 
            return true;
        }
    }

    if(splitted1.length < splitted2.length) 
        return true;
        
    return false;
};

var createDefaultApbdes = function(){
    return [
        ["1", "Pendapatan"],
        ["1.1", "Pendapatan Asli Desa"],
        ["1.1.1", "Hasil Usaha Desa"],
        ["1.2", "Pendapatan Transfer"],
        ["1.2.1", "Dana Desa"],
        ["1.2.2", "Bagian dari Hasil Pajak & Retribusi Daerah Kabupaten/Kota"],
        ["1.2.3", "Alokasi Dana Desa"],
        ["1.2.4", "Bantuan Keuangan"],
        ["1.2.4.1", "Bantuan Keuangan dari APBD Propinsi"],
        ["1.2.4.2", "Bantuan Keuangan dari APBD Kabupaten"],
        ["1.3", "Lain-lain Pendapatan Desa yang Sah"],
        ["1.3.1", "Hibah dan Sumbangan dari Pihak Ke-3 yang Tidak Mengikat"],
        ["2", "Belanja"],
        ["2.1", "Bidang Penyelenggaraan Pemerintah Desa"],
        ["2.2", "Bidang Pelaksanaan Pembangunan Desa"],
        ["2.3", "Bidang Pembinaan Kemasyarakatan"],
        ["2.4", "Bidang Pemberdayaan Masyarakat"],
        ["3", "Pembiayaan"],
        ["3.1", "Penerimaan Pembiayaan"],
        ["3.1.1", "SILPA"],
        ["3.1.2", "Pencairan Dana Cadangan"],
        ["3.1.3", "Hasil Kekayaan Desa yang Dipisahkan"],
        ["3.2", "Pengeluaran Pembiayaan"],
        ["3.2.1", "Pembentukan Dana Cadangan"],
        ["3.2.2", "Penyertaan Modal Desa"],
    ];
}

var ApbdesComponent = Component({
    selector: 'apbdes',
    templateUrl: 'templates/apbdes.html'
})
.Class(Object.assign(diffProps, {
    constructor: function(appRef, zone) {
        this.appRef = appRef;
        this.zone = zone;
    },
    ngOnInit: function(){
        $("title").html("APBDes - " +dataapi.getActiveAuth().desa_name);
        init();
        
        var inputSearch = document.getElementById("input-search");
        this.tableSearcher = initializeTableSearch(hot, document, inputSearch);
    
        this.hots = {};
        this.initialDatas = {};
        var ctrl = this;

        function keyup(e) {
            //ctrl+s
            if (e.ctrlKey && e.keyCode == 83){
                ctrl.saveContent();
                e.preventDefault();
                e.stopPropagation();
            }
        }
        document.addEventListener('keyup', keyup, false);

        this.activeSubType = null;
        dataapi.getContentSubTypes("apbdes", subTypes => {
            this.subTypes = subTypes;
            this.appRef.tick();
            if(this.subTypes.length)
                this.loadSubType(subTypes[0]);
        });
        this.initDiffComponent(true);
    },
    loadSubType(subType){
        if(!this.hots[subType]){
            this.hots[subType] = initSheet(subType);
            dataapi.getContent("apbdes", subType, [], content => {
                this.zone.run( () => {
                    this.hot = hot = this.hots[subType];
                    this.activeSubType = subType;
                    this.initialDatas[subType] = JSON.parse(JSON.stringify(content.data));
                    this.hot.loadData(content.data);
                    setTimeout(() => {
                        this.hot.render();
                    },500);
                });
            });
        } else {
            this.hot = hot = this.hots[subType];
            this.activeSubType = subType;
            this.hot.render();
        }
        return false;
    },
    importExcel: function(){
        var files = remote.dialog.showOpenDialog();
        if(files && files.length){
            var objData = importApbdes(files[0]);
            var data = objData.map(o => schemas.objToArray(o, schemas.apbdes));

            hot.loadData(data);
            setTimeout(function(){
                hot.render();
            },500);
        }
    },
    exportExcel: function(){
        var data = hot.getSourceData();
        exportApbdes(data, "Apbdes");
    },
    openAddRowDialog: function(){
        $("#modal-add").modal("show");
        setTimeout(() => {
            this.hot.unlisten();
            $("input[name='account_code']").focus();
        }, 500);
        return false;
    },
    addRow: function(){
        var data = $("#form-add").serializeArray().map(i => i.value);
        var sourceData = hot.getSourceData();
        var position = 0;
        for(;position < sourceData.length; position++){
            if(isCodeLesserThan(data[0], sourceData[position][0]))
                break;
        };
        if(data[1]=="on"){
            data[0]="";
            data.splice(1,1)
        };
        hot.alter("insert_row", position);
        hot.populateFromArray(position, 0, [data], position, 3, null, 'overwrite');
        hot.selection.setRangeStart(new WalkontableCellCoords(position,0));
        hot.selection.setRangeEnd(new WalkontableCellCoords(position,3));
        $('#form-add')[0].reset();
    },
    addOneRow: function(){
        this.addRow();
        $("#modal-add").modal("hide");
    },
    addOneRowAndAnother: function(){
        var code = $("input[name='account_code']").val();
        this.addRow();
        $("input[name='account_code']").focus().val(code).select();
        return false;
    },
    openNewSubTypeDialog: function(){
        $("#modal-new-year").modal("show");
        setTimeout(function(){
            hot.unlisten();
            $("input[name='year']").focus();
        }, 500);
        return false;
    },
    createNewSubType: function(){
        var year = $("#form-new-year input[name='year']").val();
        var is_perubahan = $("#form-new-year input[name='is_perubahan']")[0].checked;
        var subType = year;
        if(is_perubahan)
            subType = subType+"p";
            
        //TODO: show error already exists
        if(this.subTypes.filter(s => s == subType).length)
            return;
          
        this.activeSubType = subType;
        this.subTypes.push(subType);
        this.appRef.tick();
        this.hots[subType] = initSheet(subType);
        this.initialDatas[subType] = [];
        this.hot = hot = this.hots[subType];
        hot.loadData(createDefaultApbdes());
        $("#modal-new-year").modal("hide");
        return false;
    },
    saveContent: function(){
        $("#modal-save-diff").modal("hide");
        var count = 0;
        this.diffs.subTypes.filter(s => this.diffs.diffs[s].total).forEach(subType => {
            count += 1;
            var timestamp = new Date().getTime();
            var content = {
                timestamp: timestamp,
                data: hot.getSourceData()
            };
            
            var that = this;
            that.savingMessage = "Menyimpan...";
            dataapi.saveContent("apbdes", subType, content, function(err, response, body){
                count -= 1;
                that.savingMessage = "Penyimpanan "+ (err ? "gagal" : "berhasil");
                if(!err){
                    that.initialDatas[subType] = JSON.parse(JSON.stringify(content.data));
                    if(count == 0)
                        that.afterSave();
                }
                setTimeout(function(){
                    that.savingMessage = null;
                }, 2000);
            });
        });
        return false;
    }
}));
ApbdesComponent.parameters = [ApplicationRef, NgZone];

export default ApbdesComponent;